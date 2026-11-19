"""τ²-bench Retail (sierra-research/tau2-bench), run through the official package.

tau2 supplies the retail tools and database, the LLM customer simulator, the
turn-taking orchestrator and the evaluator (database state, reference actions,
natural-language assertions). `ConfigAgent` plugs a saved configuration into
tau2's agent interface and hands tool calls back to the orchestrator to execute.
"""

from __future__ import annotations

import json
import os
import threading
import time
import types
import uuid
from datetime import datetime, timezone
from typing import Any

from app.benchmarks.conversation import ConversationAgent, Trace, db_changes, describe_outcome
from app.config import settings
from app.datasets.registry import Task as HarnessTask
from app.llm import litellm_name
from app.pricing import cost_usd
from app.schemas import AgentConfiguration, RunResult
from app.spend_guard import RunMeter

# tau2 reads TAU2_DATA_DIR at import time, so it must be set before the first import.
os.environ.setdefault("TAU2_DATA_DIR", str(settings()["tau2_data_dir"]))

# tau2 logs every message at INFO/DEBUG through loguru; keep the server log readable.
try:
    import sys as _sys

    from loguru import logger as _loguru

    _loguru.remove()
    _loguru.add(_sys.stderr, level="WARNING")
except Exception:
    pass

from tau2.agent.base_agent import HalfDuplexAgent  # noqa: E402
from tau2.data_model.message import (  # noqa: E402
    AssistantMessage,
    Message,
    MultiToolMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
    UserMessage,
)
from tau2.data_model.tasks import Task as TauTask  # noqa: E402
from tau2.domains.retail.data_model import RetailDB  # noqa: E402
from tau2.domains.retail.environment import get_environment, get_tasks  # noqa: E402
from tau2.domains.retail.utils import RETAIL_DB_PATH  # noqa: E402
from tau2.evaluator.evaluator import EvaluationType  # noqa: E402
from tau2.orchestrator.orchestrator import Orchestrator  # noqa: E402
from tau2.runner.build import user_tools_for_task  # noqa: E402
from tau2.runner.simulation import run_simulation  # noqa: E402
from tau2.user.user_simulator import UserSimulator  # noqa: E402

BENCHMARK_ID = "tau2-retail"
PREFIX = "tau2-retail-"
_lock = threading.Lock()
_cache: list[TauTask] | None = None


def tau_tasks() -> list[TauTask]:
    global _cache
    with _lock:
        if _cache is None:
            _cache = get_tasks("base")
        return list(_cache)


def harness_task(tau: TauTask) -> HarnessTask:
    """The customer's situation as the harness sees it, nothing about grading."""
    inst = tau.user_scenario.instructions
    if hasattr(inst, "reason_for_call"):
        question = inst.reason_for_call or ""
        known = inst.known_info or ""
        persona = inst.task_instructions or ""
    else:
        question, known, persona = str(inst), "", ""
    crit = tau.evaluation_criteria
    actions = (crit.actions if crit else None) or []
    basis = [str(getattr(b, "value", b)) for b in ((crit.reward_basis if crit else None) or [])]
    return HarnessTask(
        id=f"{PREFIX}{tau.id}",
        benchmark_id=BENCHMARK_ID,
        question=question,
        expected_answer=None,
        context=f"{known}\n{persona}".strip(),
        metadata={"tau_id": tau.id, "reward_basis": basis,
                  "reference_tools": sorted({a.name for a in actions})},
    )


def find_tau_task(task_id: str) -> TauTask:
    raw = task_id.removeprefix(PREFIX)
    for t in tau_tasks():
        if t.id == raw:
            return t
    raise KeyError(f"Task {task_id} not found in {BENCHMARK_ID}")


def _to_wire(messages: list[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        if isinstance(m, UserMessage):
            out.append({"role": "user", "content": m.content or ""})
        elif isinstance(m, AssistantMessage):
            out.append({"role": "assistant", "content": m.content or "",
                        "tool_calls": [{"id": c.id, "name": c.name, "arguments": c.arguments}
                                       for c in (m.tool_calls or [])]})
        elif isinstance(m, ToolMessage):
            out.append({"role": "tool", "tool_call_id": m.id, "content": m.content or ""})
    return out


class ConfigAgent(HalfDuplexAgent[list[Message]]):
    def __init__(self, agent: ConversationAgent, tools, domain_policy: str):
        super().__init__(tools=tools, domain_policy=domain_policy)
        self.agent = agent
        self.schemas = [t.openai_schema for t in tools]

    def get_init_state(self, message_history: list[Message] | None = None) -> list[Message]:
        return list(message_history or [])

    def generate_next_message(self, message, state: list[Message]):
        if isinstance(message, MultiToolMessage):
            state.extend(message.tool_messages)
            for r in message.tool_messages:
                self.agent.tool_result(r.id, r.content or "", bool(r.error))
        elif message is not None:
            state.append(message)
            if isinstance(message, ToolMessage):
                self.agent.tool_result(message.id, message.content or "", bool(message.error))
        reply = self.agent.respond(_to_wire(state), self.schemas)
        msg = AssistantMessage(
            role="assistant",
            content=None if reply.tool_calls else reply.text,
            tool_calls=[ToolCall(id=c.id, name=c.name, arguments=c.arguments) for c in reply.tool_calls] or None,
            cost=reply.step.cost_usd,
            usage={"prompt_tokens": reply.step.prompt_tokens, "completion_tokens": reply.step.completion_tokens},
        )
        state.append(msg)
        return msg, state

    def is_stop(self, message: AssistantMessage) -> bool:
        return False


def _conversation(messages: list[Message]) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        if isinstance(m, SystemMessage):
            continue
        entry: dict[str, Any] = {"role": m.role, "turn": m.turn_idx}
        if isinstance(m, ToolMessage):
            entry.update(tool_call_id=m.id, content=m.content, error=bool(m.error), requestor=m.requestor)
        else:
            entry["content"] = m.content
            if getattr(m, "tool_calls", None):
                entry["tool_calls"] = [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in m.tool_calls]
            if getattr(m, "cost", None):
                entry["cost_usd"] = m.cost
        out.append(entry)
    return out


def lenient_json_loads(text: str):
    """json.loads that survives a model wrapping its JSON in a code fence or a sentence."""
    import re

    text = (text or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        try:
            return json.loads(fenced.group(1).strip())
        except json.JSONDecodeError:
            pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start:end + 1])
    raise json.JSONDecodeError("No JSON object in judge reply", text, 0)


def _point_judges_at(model: str) -> None:
    """tau2's judges default to a model this deployment may not have; use ours, and
    parse their replies leniently (Claude sometimes fences the JSON)."""
    claude = model.split("/")[-1].lower().startswith("claude")
    try:
        import tau2.evaluator.evaluator_nl_assertions as nl
        nl.DEFAULT_LLM_NL_ASSERTIONS = model
        nl.json = types.SimpleNamespace(loads=lenient_json_loads, dumps=json.dumps)
        if claude:
            nl.DEFAULT_LLM_NL_ASSERTIONS_ARGS = {
                k: v for k, v in dict(nl.DEFAULT_LLM_NL_ASSERTIONS_ARGS).items() if k not in ("temperature", "reasoning_effort")
            }
    except Exception:
        pass
    try:
        import tau2.data_model.semantic_communication as sc
        sc.DEFAULT_SEMANTIC_COMMUNICATE_MODEL = model
        if claude:
            sc.DEFAULT_SEMANTIC_COMMUNICATE_MODEL_ARGS = {
                k: v for k, v in dict(sc.DEFAULT_SEMANTIC_COMMUNICATE_MODEL_ARGS).items() if k not in ("temperature", "reasoning_effort")
            }
    except Exception:
        pass


def _dump(x: Any) -> Any:
    if x is None:
        return None
    if hasattr(x, "model_dump"):
        return x.model_dump(mode="json")
    if isinstance(x, list):
        return [_dump(i) for i in x]
    if isinstance(x, dict):
        return {str(getattr(k, "value", k)): _dump(v) for k, v in x.items()}
    return x


# The simulated customer re-reads its instructions and the whole conversation on every
# turn. Marking the system message and the latest message for Anthropic's prompt cache
# bills those repeats at the cache-read rate; the prompt text itself is not changed.
_CUSTOMER_CACHE_POINTS = [
    {"location": "message", "role": "system"},
    {"location": "message", "index": -1},
]


def _keep_cache_usage() -> None:
    """Make τ² keep the cache-read and cache-write token counts it otherwise drops."""
    import tau2.utils.llm_utils as llm_utils

    if getattr(llm_utils.get_response_usage, "_keeps_cache", False):
        return

    def get_response_usage(response):  # type: ignore[no-untyped-def]
        usage = response.get("usage")
        if usage is None:
            return None
        details = getattr(usage, "prompt_tokens_details", None)
        read = getattr(usage, "cache_read_input_tokens", None) or getattr(details, "cached_tokens", 0) or 0
        write = getattr(usage, "cache_creation_input_tokens", 0) or 0
        return {
            "completion_tokens": usage.completion_tokens,
            "prompt_tokens": usage.prompt_tokens,
            "cache_read_tokens": int(read),
            "cache_write_tokens": int(write),
        }

    get_response_usage._keeps_cache = True  # type: ignore[attr-defined]
    llm_utils.get_response_usage = get_response_usage


def run_task(config: AgentConfiguration, task: HarnessTask, *, mode: str, meter: RunMeter,
             model_override: str | None = None, parent_run_id: str | None = None) -> RunResult:
    s = settings()
    tau = find_tau_task(task.id)
    _point_judges_at(litellm_name(s["tau_judge_model"]))
    _keep_cache_usage()
    env = get_environment()
    db_before = RetailDB.load(RETAIL_DB_PATH).model_dump(mode="json")
    agent = ConversationAgent(config, env.get_policy(), mode=mode, meter=meter, model_override=model_override)
    # One conversation is many round trips: allow every turn its calls (router + agents)
    meter.max_calls = max(meter.max_calls or 0, int(s["tau_max_steps"]) * (len(agent.agents) + 1))
    user = UserSimulator(
        llm=litellm_name(s["tau_user_model"]),
        instructions=str(tau.user_scenario),
        tools=user_tools_for_task(env, tau),
        # Anthropic rejects `temperature` for current Claude models (and caches the
        # customer's repeated context instead); OpenAI accepts it and caches by itself
        llm_args=(
            {"cache_control_injection_points": _CUSTOMER_CACHE_POINTS}
            if s["tau_user_model"].lower().startswith("claude")
            else {"temperature": 0.0}
        ),
    )
    orchestrator = Orchestrator(
        domain="retail", agent=ConfigAgent(agent, env.get_tools(), env.get_policy()), user=user,
        environment=env, task=tau, max_steps=int(s["tau_max_steps"]), max_errors=10,
        simulation_id=str(uuid.uuid4()),
    )
    t0 = time.perf_counter()
    sim = run_simulation(orchestrator, evaluation_type=EvaluationType.ALL)
    latency = time.perf_counter() - t0

    ri = sim.reward_info
    reward = float(ri.reward) if ri else 0.0
    success = reward >= 1.0
    messages = sim.messages or []
    final_text = next((m.content for m in reversed(messages) if isinstance(m, AssistantMessage) and m.content), "")
    # Price the customer's turns ourselves: litellm's table lags behind new model ids
    user_cost = sum(
        cost_usd(
            s["tau_user_model"],
            int(m.usage.get("prompt_tokens") or 0),
            int(m.usage.get("completion_tokens") or 0),
            cache_read_tokens=int(m.usage.get("cache_read_tokens") or 0),
            cache_write_tokens=int(m.usage.get("cache_write_tokens") or 0),
        )
        for m in messages if isinstance(m, UserMessage) and getattr(m, "usage", None)
    ) or float(sim.user_cost or 0.0)
    meter.add_cost(user_cost)
    ended = str(getattr(sim.termination_reason, "value", sim.termination_reason))
    basis = [str(getattr(b, "value", b)) for b in ((ri.reward_basis if ri else None) or [])]
    evaluation = {
        "benchmark": "τ²-bench retail",
        "reward": reward,
        "reward_basis": basis,
        "reward_breakdown": _dump(ri.reward_breakdown) if ri else {},
        "db_match": ri.db_check.db_match if ri and ri.db_check else None,
        "action_checks": _dump(ri.action_checks) if ri else [],
        "communicate_checks": _dump(ri.communicate_checks) if ri else [],
        "nl_assertions": _dump(ri.nl_assertions) if ri else [],
        "info": _dump(ri.info) if ri else None,
        "termination_reason": ended,
        "turns": len(messages),
        "user_simulator_model": s["tau_user_model"],
        "user_simulator_cost_usd": round(user_cost, 6),
    }
    trace = agent.trace
    tool_calls = sum(len(st.tool_calls) for st in trace.steps)
    return RunResult(
        id=f"RUN-{uuid.uuid4().hex[:8].upper()}",
        mode=mode,
        benchmark_id=BENCHMARK_ID,
        task_id=task.id,
        configuration_id=config.id,
        configuration_name=config.name,
        architecture=config.architecture,
        model=", ".join(trace.models),
        temperature=agent.temperature,
        question=task.question,
        expected_answer=None,
        answer=final_text,
        success=success,
        latency_sec=round(latency, 3),
        prompt_tokens=trace.prompt_tokens,
        completion_tokens=trace.completion_tokens,
        cost_usd=round(trace.cost_usd + user_cost, 6),
        note=describe_outcome(success, reward, f"basis {', '.join(basis) or 'DB'}", len(trace.steps), tool_calls, ended),
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=trace.steps[0].system_prompt if trace.steps else None,
        configuration=config,
        parent_run_id=parent_run_id,
        status="completed",
        steps=trace.steps,
        llm_calls=trace.llm_calls,
        conversation=_conversation(messages),
        evaluation=evaluation,
        db_changes=db_changes(db_before, env.tools.db.model_dump(mode="json")),
    )

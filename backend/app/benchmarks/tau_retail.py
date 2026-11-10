"""τ-bench Retail (sierra-research/tau-bench, the original), run through the official package.

tau-bench exposes a gym-style environment: `reset` gives the customer's opening
message, `step` either runs a tool against the mock database or sends a message
to the LLM customer simulator. Reward is computed when the conversation ends by
replaying the reference actions and comparing database hashes, plus checking
that any required facts were told to the customer.
"""

from __future__ import annotations

import copy
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from litellm import completion
from tau_bench.envs.base import consistent_hash, to_hashable
from tau_bench.envs.retail.env import MockRetailDomainEnv
from tau_bench.envs.retail.tasks_test import TASKS_TEST
from tau_bench.envs.user import LLMUserSimulationEnv
from tau_bench.types import RESPOND_ACTION_NAME, Action
from tau_bench.types import Task as TauTask

from app.benchmarks.conversation import ConversationAgent, db_changes, describe_outcome
from app.config import settings
from app.datasets.registry import Task as HarnessTask
from app.llm import infer_provider
from app.schemas import AgentConfiguration, RunResult
from app.spend_guard import RunMeter

BENCHMARK_ID = "tau-retail"
PREFIX = "tau-retail-"


def tau_tasks() -> list[TauTask]:
    return list(TASKS_TEST)


def harness_task(index: int, tau: TauTask) -> HarnessTask:
    return HarnessTask(
        id=f"{PREFIX}{index:03d}",
        benchmark_id=BENCHMARK_ID,
        question=tau.instruction,
        expected_answer=None,
        context="",
        metadata={"index": index, "user_id": tau.user_id,
                  "reference_tools": sorted({a.name for a in tau.actions if a.name != RESPOND_ACTION_NAME}),
                  "required_outputs": len(tau.outputs)},
    )


def task_index(task_id: str) -> int:
    idx = int(task_id.removeprefix(PREFIX))
    if not 0 <= idx < len(TASKS_TEST):
        raise KeyError(f"Task {task_id} not found in {BENCHMARK_ID}")
    return idx


class CostedUser(LLMUserSimulationEnv):
    """tau-bench's simulator keeps only the last reply's cost, and its constructor
    makes an LLM call with no instruction. This one adds costs up and waits for
    `reset(instruction)` before talking."""

    def __init__(self, model: str, provider: str) -> None:
        self.messages: list[dict[str, Any]] = []
        self.model = model
        self.provider = provider
        self.total_cost = 0.0

    def generate_next_message(self, messages: list[dict[str, Any]]) -> str:
        res = completion(model=self.model, custom_llm_provider=self.provider, messages=messages)
        message = res.choices[0].message
        self.messages.append(message.model_dump())
        self.total_cost += float(res._hidden_params.get("response_cost") or 0.0)
        return message.content or ""


def run_task(config: AgentConfiguration, task: HarnessTask, *, mode: str, meter: RunMeter,
             model_override: str | None = None, parent_run_id: str | None = None) -> RunResult:
    s = settings()
    idx = task_index(task.id)
    user_model = s["tau_user_model"]
    provider = infer_provider(user_model)
    # "human" so the package does not build (and call) its own LLM customer first
    env = MockRetailDomainEnv(user_strategy="human", task_split="test", task_index=idx)
    env.user = CostedUser(model=user_model, provider=provider)
    agent = ConversationAgent(config, env.wiki, mode=mode, meter=meter, model_override=model_override)
    # One conversation is many round trips: allow every turn its calls (router + agents)
    meter.max_calls = max(meter.max_calls or 0, int(s["tau_max_steps"]) * (len(agent.agents) + 1))
    tools = env.tools_info

    t0 = time.perf_counter()
    first = env.reset(task_index=idx)
    db_before = copy.deepcopy(env.data)
    wire: list[dict[str, Any]] = [{"role": "user", "content": first.observation}]
    conversation: list[dict[str, Any]] = [{"role": "user", "turn": 0, "content": first.observation}]
    done, final, ended, agent_db = False, None, "max_steps", None
    for _ in range(int(s["tau_max_steps"])):
        reply = agent.respond(wire, tools)
        if reply.tool_calls:
            calls = [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in reply.tool_calls]
            wire.append({"role": "assistant", "content": "", "tool_calls": calls})
            conversation.append({"role": "assistant", "turn": len(conversation), "content": None,
                                 "tool_calls": calls, "cost_usd": reply.step.cost_usd})
            for c in reply.tool_calls:
                if c.name in env.terminate_tools:
                    agent_db = copy.deepcopy(env.data)
                res = env.step(Action(name=c.name, kwargs=c.arguments))
                error = res.observation.startswith(("Error:", "Unknown action"))
                agent.tool_result(c.id, res.observation, error)
                wire.append({"role": "tool", "tool_call_id": c.id, "content": res.observation})
                conversation.append({"role": "tool", "turn": len(conversation), "tool_call_id": c.id,
                                     "content": res.observation, "error": error, "requestor": "assistant"})
                if res.done:
                    done, final, ended = True, res, "agent_transfer"
                    break
        else:
            wire.append({"role": "assistant", "content": reply.text})
            conversation.append({"role": "assistant", "turn": len(conversation), "content": reply.text,
                                 "cost_usd": reply.step.cost_usd})
            agent_db = copy.deepcopy(env.data)
            res = env.step(Action(name=RESPOND_ACTION_NAME, kwargs={"content": reply.text}))
            if res.done:
                done, final, ended = True, res, "user_stop"
                break
            wire.append({"role": "user", "content": res.observation})
            conversation.append({"role": "user", "turn": len(conversation), "content": res.observation})
        if done:
            break
    latency = time.perf_counter() - t0
    if agent_db is None:
        agent_db = copy.deepcopy(env.data)

    reward = float(final.reward) if final else 0.0
    success = done and reward >= 1.0
    ri = final.info.reward_info if final else None
    info = ri.info.model_dump() if ri else {}
    user_cost = float(env.user.get_total_cost() or 0.0)
    meter.add_cost(user_cost)
    tau = env.task
    # tau-bench reports r_actions only when the task has no required outputs; compare
    # the agent's end state with the replayed reference state ourselves otherwise.
    if "r_actions" in info:
        db_match: bool | None = bool(info["r_actions"])
    elif done:
        db_match = consistent_hash(to_hashable(agent_db)) == env.get_data_hash()
    else:
        db_match = None
    evaluation = {
        "benchmark": "τ-bench retail",
        "reward": reward,
        "reward_basis": ["DB"] + (["OUTPUTS"] if tau.outputs else []),
        "db_match": db_match,
        "outputs": info.get("outputs"),
        "reference_actions": [a.model_dump() for a in tau.actions],
        "agent_actions": [a.model_dump() for a in ri.actions] if ri else [],
        # After grading, env.data holds the reference end state (tau-bench replays the gold actions)
        "expected_db_changes": db_changes(db_before, env.data) if done else None,
        "termination_reason": ended if done else "max_steps",
        "turns": len(conversation),
        "user_simulator_model": user_model,
        "user_simulator_cost_usd": round(user_cost, 6),
    }
    trace = agent.trace
    tool_calls = sum(len(st.tool_calls) for st in trace.steps)
    basis = "basis DB" + (" + required outputs" if tau.outputs else "")
    final_text = next((m["content"] for m in reversed(wire) if m["role"] == "assistant" and m.get("content")), "")
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
        note=describe_outcome(success, reward, basis, len(trace.steps), tool_calls, evaluation["termination_reason"]),
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=trace.steps[0].system_prompt if trace.steps else None,
        configuration=config,
        parent_run_id=parent_run_id,
        status="completed",
        steps=trace.steps,
        llm_calls=trace.llm_calls,
        conversation=conversation,
        evaluation=evaluation,
        db_changes=db_changes(db_before, agent_db),
    )

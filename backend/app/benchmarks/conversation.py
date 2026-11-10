"""A saved configuration acting as one side of a multi-turn, tool-using conversation.

Both τ-bench generations drive the loop themselves (their environment executes the
tools, their simulator plays the customer). What they need from us is a function
"given the conversation so far and the tool schemas, what does the agent say or
call next?". `ConversationAgent.respond` is that function, with the architecture
mapped onto a conversation like this:

- single agent / any pipeline config: the first agent node answers every turn
- routing: the Router picks one specialist from the customer's opening message
- prompt chain: earlier steps write private notes each turn; the last step speaks

Every model call is one `TraceStep` so the Runs page can show who spoke when, and
tool results are written back onto the step that requested them.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from app.llm import default_model_for, default_provider, infer_provider
from app.llm_turn import TurnToolCall, chat_turn
from app.schemas import AgentConfiguration, ConfigurationNode, TraceStep
from app.spend_guard import RunMeter

AGENT_INSTRUCTION = (
    "You are a customer service agent that helps the user according to the <policy> "
    "provided below. In each turn you can either send a message to the user or make "
    "tool calls, not both. Follow the policy exactly; never invent order, product or "
    "user details: look them up with the tools."
)


@dataclass
class TurnSpec:
    node: ConfigurationNode
    provider: str
    model: str
    temperature: float
    system_prompt: str
    role: str
    instructions: str


@dataclass
class Reply:
    text: str
    tool_calls: list[TurnToolCall]
    step: TraceStep


@dataclass
class Trace:
    steps: list[TraceStep] = field(default_factory=list)
    pending: dict[str, TraceStep] = field(default_factory=dict)

    def record(self, step: TraceStep) -> TraceStep:
        step.index = len(self.steps)
        self.steps.append(step)
        return step

    def tool_result(self, call_id: str, content: str, error: bool = False) -> None:
        step = self.pending.pop(call_id, None)
        if not step:
            return
        for call in step.tool_calls:
            if call.get("id") == call_id:
                call.update(result=content, error=error, executed=True)

    @property
    def cost_usd(self) -> float:
        return sum(s.cost_usd for s in self.steps)

    @property
    def prompt_tokens(self) -> int:
        return sum(s.prompt_tokens for s in self.steps)

    @property
    def completion_tokens(self) -> int:
        return sum(s.completion_tokens for s in self.steps)

    @property
    def llm_calls(self) -> int:
        return sum(s.llm_calls for s in self.steps)

    @property
    def models(self) -> list[str]:
        return list(dict.fromkeys(s.model for s in self.steps if s.model))


def spec_for(node: ConfigurationNode, override: str | None) -> TurnSpec:
    ms = node.modelSettings
    provider = (ms.provider if ms and ms.provider else default_provider()).strip().lower()
    model = (ms.model if ms and ms.model else "") or ""
    if not model or model.lower() in {"gpt", "claude", "gemini", "model"}:
        model = default_model_for(provider)
    if override:
        model, provider = override, infer_provider(override)
    ps = node.promptStep
    meta = node.metadata or {}
    role = (ps.role if ps and ps.role and ps.role != "custom" else meta.get("role") or node.name) or node.name
    instructions = "\n\n".join(
        x for x in [
            ps.objective if ps else "",
            ps.instructions if ps else "",
            "" if ps else str(meta.get("instructions") or ""),
        ] if x
    )
    return TurnSpec(
        node=node,
        provider=provider,
        model=model.strip(),
        temperature=float(ms.temperature) if ms and ms.temperature is not None else 0.0,
        system_prompt=(ms.systemPrompt or "").strip() if ms else "",
        role=str(role),
        instructions=instructions,
    )


class ConversationAgent:
    def __init__(self, config: AgentConfiguration, policy: str, *, mode: str, meter: RunMeter,
                 model_override: str | None = None, trace: Trace | None = None):
        self.config = config
        self.policy = policy
        self.mode = mode
        self.meter = meter
        self.trace = trace or Trace()
        agents = sorted((n for n in config.nodes if n.type == "model"), key=lambda n: n.order)
        if not agents:
            raise RuntimeError("Configuration has no agent nodes to run.")
        self.agents = [spec_for(n, model_override) for n in agents]
        router = next((n for n in config.nodes if n.type == "router"), None)
        self.router = spec_for(router, model_override) if router and mode == "routing" else None
        self.chain = mode == "prompt-chain" and len(self.agents) > 1
        self.specialist: TurnSpec | None = None
        # Chain notes are refreshed when the customer says something new, not after
        # every tool result: that halves the chain's calls without changing what it knows.
        self.notes: str | None = None

    @property
    def temperature(self) -> float:
        return self.agents[0].temperature

    # -- one turn ----------------------------------------------------------------------

    def respond(self, wire: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Reply:
        """`wire`: OpenAI-style messages so far (user / assistant / tool). Returns either
        text for the customer or tool calls for the environment, never both."""
        speaker = self.agents[0]
        notes = ""
        if self.router:
            if self.specialist is None:
                self.specialist = self._route(wire)
            speaker = self.specialist
        elif self.chain:
            if self.notes is None or (wire and wire[-1]["role"] == "user"):
                for spec in self.agents[:-1]:
                    notes = self._note(spec, wire, notes)
                self.notes = notes
            notes = self.notes
            speaker = self.agents[-1]
        extra = f"Notes from your colleagues on this conversation so far:\n{notes}" if notes else ""
        system = self._system(speaker, extra)
        t0 = time.perf_counter()
        self.meter.before_call()
        result = chat_turn(provider=speaker.provider, model=speaker.model, system=system,
                           messages=wire, tools=tools, temperature=speaker.temperature)
        self.meter.add_cost(result.cost_usd)
        calls = result.tool_calls
        text = "" if calls else (result.text or "I'm sorry, could you say that again?")
        step = self.trace.record(TraceStep(
            index=0, node_id=speaker.node.id, node_name=speaker.node.name, node_type="model", kind="agent",
            provider=speaker.provider, model=speaker.model, system_prompt=system,
            user_prompt=wire[-1].get("content") if wire and wire[-1]["role"] == "user" else None,
            output=text or (result.text or ""),
            tool_calls=[{"id": c.id, "name": c.name, "arguments": c.arguments, "result": None} for c in calls],
            llm_calls=1, prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
            cached_tokens=result.cache_read_tokens,
            cost_usd=round(result.cost_usd, 6), latency_sec=round(time.perf_counter() - t0, 3),
        ))
        for c in calls:
            self.trace.pending[c.id] = step
        return Reply(text=text, tool_calls=calls, step=step)

    def tool_result(self, call_id: str, content: str, error: bool = False) -> None:
        self.trace.tool_result(call_id, content, error)

    # -- helpers -----------------------------------------------------------------------

    def _system(self, spec: TurnSpec, extra: str = "") -> str:
        parts = [spec.system_prompt or AGENT_INSTRUCTION]
        if spec.instructions:
            parts.append(f"Your role: {spec.role}\n{spec.instructions}")
        if extra:
            parts.append(extra)
        parts.append(f"<policy>\n{self.policy}\n</policy>")
        return "\n\n".join(parts)

    def _route(self, wire: list[dict[str, Any]]) -> TurnSpec:
        assert self.router is not None
        options = "\n".join(
            f'- id: "{a.node.id}" | role: {a.role}' + (f" | {a.instructions[:200]}" if a.instructions else "")
            for a in self.agents
        )
        opening = next((m.get("content") for m in wire if m["role"] == "user" and m.get("content")), "")
        t0 = time.perf_counter()
        self.meter.before_call()
        result = chat_turn(
            provider=self.router.provider, model=self.router.model,
            system=("You route a customer-service conversation to the single best-suited specialist. "
                    'Reply with ONLY JSON: {"route": "<agent id>", "reason": "<one sentence>"}'),
            messages=[{"role": "user", "content": f"Customer's opening message:\n{opening}\n\nSpecialists:\n{options}"}],
            temperature=0.0,
        )
        self.meter.add_cost(result.cost_usd)
        choice, reason = None, ""
        try:
            data = json.loads(result.text[result.text.find("{"): result.text.rfind("}") + 1])
            choice = str(data.get("route", "")).strip()
            reason = str(data.get("reason", ""))
        except Exception:
            pass
        chosen = next((a for a in self.agents if choice in {a.node.id, a.node.name}), self.agents[0])
        self.trace.record(TraceStep(
            index=0, node_id=self.router.node.id, node_name=self.router.node.name, node_type="router", kind="router",
            provider=self.router.provider, model=self.router.model, output=result.text,
            decision={"route": chosen.node.id, "route_name": chosen.node.name, "reason": reason,
                      "fallback": choice not in {chosen.node.id, chosen.node.name}},
            llm_calls=1, prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
            cost_usd=round(result.cost_usd, 6), latency_sec=round(time.perf_counter() - t0, 3),
        ))
        return chosen

    def _note(self, spec: TurnSpec, wire: list[dict[str, Any]], earlier: str) -> str:
        transcript = "\n".join(
            f"{m['role']}: {m.get('content') or json.dumps(m.get('tool_calls'))}" for m in wire[-12:]
        )
        t0 = time.perf_counter()
        self.meter.before_call()
        result = chat_turn(
            provider=spec.provider, model=spec.model,
            system=self._system(spec, "You do not talk to the customer. Write 2-4 short numbered notes for the "
                                      "agent who will: what the customer needs, what the policy requires, what to "
                                      "check or do next."),
            messages=[{"role": "user", "content": f"Conversation so far:\n{transcript}\n\n"
                       + (f"Earlier notes:\n{earlier}\n" if earlier else "")}],
            temperature=spec.temperature,
        )
        self.meter.add_cost(result.cost_usd)
        self.trace.record(TraceStep(
            index=0, node_id=spec.node.id, node_name=spec.node.name, node_type="model", kind="agent",
            provider=spec.provider, model=spec.model, output=result.text, decision={"private_notes": True},
            llm_calls=1, prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
            cost_usd=round(result.cost_usd, 6), latency_sec=round(time.perf_counter() - t0, 3),
        ))
        return (earlier + "\n" if earlier else "") + f"[{spec.role}]\n{result.text}"


# ---- shared helpers for both adapters ------------------------------------------------

def db_changes(before: Any, after: Any) -> list[dict[str, Any]]:
    """Readable list of what a conversation changed in a JSON-like database."""
    from deepdiff import DeepDiff, extract

    diff = DeepDiff(before, after, ignore_order=True)
    changes: list[dict[str, Any]] = []
    for kind in ("values_changed", "type_changes"):
        for path, change in (diff.get(kind) or {}).items():
            changes.append({"path": _path(path), "change": "changed",
                            "from": _short(change.get("old_value")), "to": _short(change.get("new_value"))})
    for kind, label, source in (("dictionary_item_added", "added", after), ("iterable_item_added", "added", after),
                                ("dictionary_item_removed", "removed", before),
                                ("iterable_item_removed", "removed", before)):
        items = diff.get(kind) or {}
        for path in (items.keys() if isinstance(items, dict) else items):
            if isinstance(items, dict):
                value = items[path]
            else:
                try:
                    value = extract(source, str(path))
                except Exception:
                    value = None
            changes.append({"path": _path(str(path)), "change": label, "value": _short(value)})
    return changes[:200]


def _path(path: str) -> str:
    out = path.replace("root", "", 1)
    for a, b in (("']['", "."), ("['", ""), ("']", ""), ("][", "."), ("[", "."), ("]", "")):
        out = out.replace(a, b)
    return out.lstrip(".")


def _short(value: Any) -> Any:
    text = json.dumps(value, default=str)
    return value if len(text) <= 300 else text[:300] + "…"


def describe_outcome(success: bool, reward: float, basis: str, turns: int, tool_calls: int, ended: str) -> str:
    return (
        f"{'Task completed' if success else 'Task not completed'} per the official evaluator "
        f"(reward {reward:.0%}, {basis}). {turns} agent turns, {tool_calls} tool calls; ended on {ended}."
    )

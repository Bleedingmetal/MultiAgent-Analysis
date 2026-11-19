"""
Generic executor for builder configurations.

Layers run in order; node *types* decide behavior, so presets and custom configs share
one code path (edges are visual only):

- input            task question + context (always visible to every agent)
- orchestration    Router -> next agents layer runs ONE chosen agent
                   Parallel Controller -> next agents layer runs ALL agents concurrently,
                   each on a subtask the controller assigns (or the full task)
- agents           no orchestrator -> sequential chain, each agent sees the previous output.
                   Evaluator nodes gate the candidate before them: accept, or send it back to
                   its producer with feedback (up to N rounds)
- tools            Tool nodes give every agent real tools (tool-calling loop)
- aggregation      Aggregator LLM merges all incoming outputs into one
- output           final answer; if several outputs arrive, a free majority vote picks one

A single-agent config is just a one-node chain, so baselines and multi-agent runs are
measured by the same code.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from app.config import settings
from app.datasets.registry import (
    Task,
    _truncate_middle,
    parse_final_quantity,
    response_format_for,
    split_reasoning_and_answer,
    system_prompt_for,
)
from app.llm import (
    LLMResult,
    complete,
    default_model_for,
    default_provider,
    infer_provider,
    require_provider,
)
from app.runners.execute import score_task_output
from app.runners.tools import build_toolset, tool_kind_for
from app.schemas import (
    AgentConfiguration,
    ConfigurationNode,
    RunResult,
    TraceStep,
)
from app.spend_guard import RunMeter

# Placeholder names the builder may store instead of a real model id
_GENERIC_MODEL_NAMES = {"gpt", "claude", "gemini", "model", ""}

LLM_NODE_TYPES = {"model", "router", "parallel-controller", "evaluator", "aggregator"}

INTERMEDIATE_NOTE = (
    "You are one step in a multi-agent pipeline. Your output is passed to the next agent, "
    "not shown to the user. Do your part thoroughly and state any figures you rely on. "
    "Write your working as short numbered steps, each on its own line."
)
WORKER_NOTE = (
    "You are one of several parallel workers. Your output will be combined with the other "
    "workers' outputs by an aggregator. Focus on your assignment and write your "
    "working as short numbered steps, each on its own line."
)

ROUTER_SYSTEM = (
    "You are a router in a multi-agent system. Pick the single agent best suited to the task. "
    'Reply with ONLY JSON: {"route": "<agent id>", "reason": "<one sentence>"}'
)
CONTROLLER_SYSTEM = (
    "You are the controller of parallel workers. Decide per task whether to SPLIT it into "
    "distinct subtasks (one per worker, only when the task genuinely decomposes) or "
    "REPLICATE it (every worker solves the whole task independently, for cross-checking). "
    'Reply with ONLY JSON: {"strategy": "split" | "replicate", "rationale": "<one sentence>", '
    '"assignments": [{"worker": "<worker id>", "subtask": "<instructions>"}]}'
)
EVALUATOR_SYSTEM = (
    "You are a strict reviewer. Check the candidate answer against the provided evidence: "
    "correct figures, correct arithmetic, correct units/scale, answers the actual question, "
    "and follows the required final-answer format. You do not know the reference answer. "
    'Reply with ONLY JSON: {"verdict": "accept" | "revise", "feedback": "<specific fixes, or empty>"}'
)
AGGREGATOR_SYSTEM = (
    "You combine the outputs of several agents into one answer. Reconcile disagreements by "
    "checking them against the evidence; do not just average. Prefer the best-supported result."
)


@dataclass
class Output:
    node: ConfigurationNode
    text: str
    # Re-invoke the producer with (previous_text, feedback); None if not revisable
    revise: Callable[[str, str], "Output"] | None = None
    round: int = 1


@dataclass
class ModelSpec:
    provider: str
    model: str
    temperature: float
    max_tokens: int | None
    system_prompt: str | None


def _parse_json(raw: str) -> dict[str, Any] | None:
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _meta(node: ConfigurationNode, key: str) -> Any:
    return (node.metadata or {}).get(key)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _vote_key(text: str) -> str:
    _, span = split_reasoning_and_answer(text)
    parsed = parse_final_quantity(span)
    if parsed is None:
        return span.strip().lower()
    if parsed.is_yes_no:
        return f"yn:{parsed.yes_no}"
    value = parsed.value * parsed.scale
    if parsed.is_percent:
        value /= 100.0
    return f"num:{value:.6g}"


class PipelineRun:
    def __init__(
        self,
        config: AgentConfiguration,
        task: Task,
        *,
        meter: RunMeter,
        model_override: str | None = None,
    ) -> None:
        self.config = config
        self.task = task
        self.meter = meter
        self.override = (model_override or "").strip() or None
        self.s = settings()
        self.dataset_prompt = system_prompt_for(task.benchmark_id)
        # Same answer layout as every other runner (FinQA adds a Program line)
        self.final_format = response_format_for(task.benchmark_id)
        self.steps: list[TraceStep] = []
        self._lock = threading.Lock()

        self.layers = sorted(config.layers, key=lambda l: l.get("order", 0))
        self.layer_nodes: dict[str, list[ConfigurationNode]] = {}
        for node in config.nodes:
            self.layer_nodes.setdefault(node.layerId, []).append(node)
        for nodes in self.layer_nodes.values():
            nodes.sort(key=lambda n: n.order)

        models = sorted(
            (n for n in config.nodes if n.type == "model"), key=lambda n: n.order
        )
        self.default_model_node = models[0] if models else None
        tool_kinds = [
            tool_kind_for(n.name, n.metadata) for n in config.nodes if n.type == "tool"
        ]
        self.tools, self.tool_executor = build_toolset(tool_kinds, task)
        self.max_tool_steps: int | None = None
        self.fab = None
        if task.benchmark_id == "fab":
            # FAB is research: every agent gets the benchmark's tools (as tau gives its
            # store tools), on top of any Tool nodes the configuration has.
            from app.benchmarks.fab_tools import FabToolbox

            self.fab = FabToolbox(before_call=meter.before_call)
            own_executor = self.tool_executor
            fab_names = set(self.fab.names)
            self.tools = self.fab.specs + [t for t in self.tools if t.name not in fab_names]

            def execute(name: str, args: dict) -> str:
                return self.fab.execute(name, args) if name in fab_names else own_executor(name, args)

            self.tool_executor = execute
            self.max_tool_steps = self.s["fab_max_tool_steps"]
        self.final_ids = self._final_node_ids()

    # ---- structure -------------------------------------------------------

    def _nodes(self, layer: dict[str, Any]) -> list[ConfigurationNode]:
        return self.layer_nodes.get(layer.get("id", ""), [])

    def _orchestrator_before(self, index: int) -> ConfigurationNode | None:
        """Router / controller in the nearest orchestration layer before an agents layer."""
        for layer in reversed(self.layers[:index]):
            if layer.get("type") == "agents":
                return None
            if layer.get("type") == "orchestration":
                for node in self._nodes(layer):
                    if node.type in {"router", "parallel-controller"}:
                        return node
        return None

    def _final_node_ids(self) -> set[str]:
        """Nodes whose output is the pipeline's answer: they get the answer format."""
        for i in range(len(self.layers) - 1, -1, -1):
            layer = self.layers[i]
            nodes = self._nodes(layer)
            if layer.get("type") == "aggregation":
                aggs = [n.id for n in nodes if n.type == "aggregator"]
                if aggs:
                    return set(aggs)
            if layer.get("type") == "agents":
                models = [n for n in nodes if n.type == "model"]
                aggs = [n for n in nodes if n.type == "aggregator"]
                if not models and not aggs:
                    continue
                orch = self._orchestrator_before(i)
                if orch is not None and models:
                    return {n.id for n in models}
                producers = [n for n in nodes if n.type in {"model", "aggregator"}]
                return {producers[-1].id}
        return set()

    # ---- model resolution ------------------------------------------------

    def spec_for(self, node: ConfigurationNode) -> ModelSpec:
        ms = node.modelSettings
        default = self.default_model_node.modelSettings if self.default_model_node else None
        control = node.type != "model"
        provider = (ms.provider if ms and ms.provider else None) or (
            default.provider if default and default.provider else default_provider()
        )
        model = (ms.model if ms and ms.model else None)
        if ms is None or not ms.provider:
            # Control node without its own settings inherits the first agent's model
            model = default.model if default else None
        if not model or model.strip().lower() in _GENERIC_MODEL_NAMES:
            model = default_model_for(provider)
        if self.override:
            model = self.override
            provider = infer_provider(model)
        temperature = (
            ms.temperature
            if ms and ms.temperature is not None
            else (0.0 if control else 0.5)
        )
        return ModelSpec(
            provider=provider,
            model=model.strip(),
            temperature=float(temperature),
            max_tokens=ms.maxTokens if ms and ms.maxTokens else None,
            system_prompt=_text(ms.systemPrompt) if ms else None,
        )

    # ---- LLM call + trace -----------------------------------------------

    def _call(
        self,
        node: ConfigurationNode,
        kind: str,
        system: str,
        user: str,
        *,
        round_: int = 1,
        use_tools: bool = False,
    ) -> tuple[LLMResult, TraceStep]:
        spec = self.spec_for(node)
        t0 = time.perf_counter()
        if self.fab:
            self.fab.take_cost()  # retrieval spend is counted per agent turn
        result = complete(
            provider=spec.provider,
            model=spec.model,
            system=system,
            user=user,
            temperature=spec.temperature,
            max_tokens=spec.max_tokens,
            tools=self.tools if use_tools and self.tools else None,
            tool_executor=self.tool_executor if use_tools and self.tools else None,
            max_tool_steps=self.max_tool_steps,
            before_call=self.meter.before_call,
        )
        if self.fab:
            # The documents an agent read through retrieve_information cost money too
            result.cost_usd += self.fab.take_cost()
        self.meter.add_cost(result.cost_usd)
        step = TraceStep(
            index=0,
            node_id=node.id,
            node_name=node.name,
            node_type=node.type,
            kind=kind,
            provider=spec.provider,
            model=spec.model,
            round=round_,
            system_prompt=system,
            user_prompt=user,
            output=result.text,
            tool_calls=[
                {"name": c.name, "arguments": c.arguments, "result": c.result}
                for c in result.tool_calls
            ],
            llm_calls=result.calls,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            cost_usd=round(result.cost_usd, 6),
            latency_sec=round(time.perf_counter() - t0, 3),
        )
        self._record(step)
        return result, step

    def _record(self, step: TraceStep) -> None:
        with self._lock:
            step.index = len(self.steps)
            self.steps.append(step)

    # ---- prompt building -------------------------------------------------

    def _task_prompt(self, extra: str) -> str:
        """Task context + question + extra, trimming the context (not the extra) to fit."""
        question = f"Question:\n{self.task.question}"
        budget = self.s["max_prompt_chars"] - len(question) - len(extra) - 8
        context = _truncate_middle(self.task.context, max(800, budget))
        return f"{context}\n\n{question}\n\n{extra}".strip()

    @staticmethod
    def _prior_work(inputs: list[Output], limit: int = 2500) -> str:
        if not inputs:
            return ""
        blocks = [
            f"### {o.node.name}\n{_truncate_middle(o.text, limit)}" for o in inputs
        ]
        return "Work from previous agents:\n" + "\n\n".join(blocks)

    def _role_block(self, node: ConfigurationNode) -> str:
        parts = []
        role = _text(_meta(node, "role"))
        if role:
            parts.append(f"Your role: {role}")
        instructions = _text(_meta(node, "instructions"))
        if instructions:
            parts.append(f"Your instructions:\n{instructions}")
        return "\n".join(parts)

    # ---- node behaviors --------------------------------------------------

    def run_producer(
        self,
        node: ConfigurationNode,
        inputs: list[Output],
        *,
        subtask: str | None = None,
        worker: bool = False,
        feedback: tuple[str, str] | None = None,
        round_: int = 1,
    ) -> Output:
        """Agent or aggregator: produce text from the task plus upstream outputs."""
        is_agg = node.type == "aggregator"
        spec = self.spec_for(node)
        base = spec.system_prompt or (
            f"{AGGREGATOR_SYSTEM}\n\n{self.dataset_prompt}" if is_agg else self.dataset_prompt
        )
        final = node.id in self.final_ids
        parts = [self._role_block(node)]
        if subtask:
            parts.append(f"Your assigned subtask:\n{subtask}")
        parts.append(self._prior_work(inputs))
        if feedback:
            prev, fb = feedback
            parts.append(
                f"Your previous attempt:\n{_truncate_middle(prev, 2500)}\n\n"
                f"Reviewer feedback to address:\n{fb}"
            )
        if final:
            parts.append(self.final_format)
        else:
            parts.append(WORKER_NOTE if worker else INTERMEDIATE_NOTE)
        user = self._task_prompt("\n\n".join(p for p in parts if p))
        result, _ = self._call(
            node,
            "aggregator" if is_agg else "agent",
            base,
            user,
            round_=round_,
            use_tools=not is_agg,
        )
        return Output(
            node=node,
            text=result.text,
            round=round_,
            revise=lambda prev, fb: self.run_producer(
                node, inputs, subtask=subtask, worker=worker,
                feedback=(prev, fb), round_=round_ + 1,
            ),
        )

    def run_evaluator(self, node: ConfigurationNode, candidate: Output) -> Output:
        spec = self.spec_for(node)
        rounds = _meta(node, "maxRounds")
        max_rounds = int(rounds) if isinstance(rounds, (int, float)) and rounds >= 1 else self.s["max_eval_rounds"]
        system = EVALUATOR_SYSTEM
        if spec.system_prompt:
            system = f"{spec.system_prompt}\n\n{EVALUATOR_SYSTEM}"
        current = candidate
        for r in range(1, max_rounds + 1):
            criteria = _text(_meta(node, "instructions"))
            extra = (
                (f"Review criteria:\n{criteria}\n\n" if criteria else "")
                + f"Required answer format for the candidate:\n{self.final_format}\n\n"
                + f"Candidate from {current.node.name}:\n{_truncate_middle(current.text, 3000)}"
            )
            result, step = self._call(node, "evaluator", system, self._task_prompt(extra), round_=r)
            data = _parse_json(result.text) or {}
            verdict = "accept" if str(data.get("verdict", "")).lower() == "accept" else "revise"
            feedback = _text(data.get("feedback")) if data else result.text
            step.decision = {
                "verdict": verdict,
                "feedback": feedback,
                "candidate_from": current.node.name,
                "parsed": bool(data),
            }
            if verdict == "accept":
                return current
            if r == max_rounds or current.revise is None:
                step.decision["note"] = "max rounds reached; keeping last candidate"
                return current
            current = current.revise(current.text, feedback)
        return current

    def run_router(self, node: ConfigurationNode, agents: list[ConfigurationNode], inputs: list[Output]) -> ConfigurationNode:
        if len(agents) == 1:
            # Nothing to decide; don't pay for a call
            self._record(
                TraceStep(
                    index=0, node_id=node.id, node_name=node.name, node_type=node.type,
                    kind="router", decision={"route": agents[0].id, "route_name": agents[0].name,
                                             "reason": "only one agent available", "fallback": False},
                )
            )
            return agents[0]
        spec = self.spec_for(node)
        options = "\n".join(
            f'- id: "{a.id}" | name: {a.name}'
            + (f" | role: {_text(_meta(a, 'role'))}" if _text(_meta(a, "role")) else "")
            + (f" | instructions: {_text(_meta(a, 'instructions'))[:300]}" if _text(_meta(a, "instructions")) else "")
            + f" | model: {self.spec_for(a).model}"
            for a in agents
        )
        extra = "\n\n".join(
            p for p in [
                self._role_block(node),
                self._prior_work(inputs),
                f"Available agents:\n{options}",
            ] if p
        )
        system = f"{spec.system_prompt}\n\n{ROUTER_SYSTEM}" if spec.system_prompt else ROUTER_SYSTEM
        result, step = self._call(node, "router", system, self._task_prompt(extra))
        data = _parse_json(result.text) or {}
        choice = str(data.get("route", "")).strip()
        chosen = next(
            (a for a in agents if choice in {a.id, a.name}), None
        ) or next((a for a in agents if a.name.lower() == choice.lower()), None)
        step.decision = {
            "route": chosen.id if chosen else agents[0].id,
            "route_name": chosen.name if chosen else agents[0].name,
            "reason": _text(data.get("reason")),
            "fallback": chosen is None,
        }
        return chosen or agents[0]

    def run_controller(
        self, node: ConfigurationNode, workers: list[ConfigurationNode], inputs: list[Output]
    ) -> dict[str, str | None]:
        spec = self.spec_for(node)
        roster = "\n".join(
            f'- id: "{w.id}" | name: {w.name}'
            + (f" | role: {_text(_meta(w, 'role'))}" if _text(_meta(w, "role")) else "")
            + (f" | instructions: {_text(_meta(w, 'instructions'))[:300]}" if _text(_meta(w, "instructions")) else "")
            for w in workers
        )
        extra = "\n\n".join(
            p for p in [
                self._role_block(node),
                self._prior_work(inputs),
                f"Workers:\n{roster}",
            ] if p
        )
        system = f"{spec.system_prompt}\n\n{CONTROLLER_SYSTEM}" if spec.system_prompt else CONTROLLER_SYSTEM
        result, step = self._call(node, "controller", system, self._task_prompt(extra))
        data = _parse_json(result.text) or {}
        strategy = "split" if str(data.get("strategy", "")).lower() == "split" else "replicate"
        assignments: dict[str, str | None] = {w.id: None for w in workers}
        if strategy == "split":
            for item in data.get("assignments") or []:
                if not isinstance(item, dict):
                    continue
                key = str(item.get("worker", "")).strip()
                worker = next((w for w in workers if key in {w.id, w.name}), None)
                if worker and _text(item.get("subtask")):
                    assignments[worker.id] = _text(item.get("subtask"))
        step.decision = {
            "strategy": strategy,
            "rationale": _text(data.get("rationale")),
            "assignments": {
                next(w.name for w in workers if w.id == wid): (sub or "full task")
                for wid, sub in assignments.items()
            },
            "parsed": bool(data),
        }
        return assignments

    # ---- layers ----------------------------------------------------------

    def _apply_evaluators(self, evaluators: list[ConfigurationNode], outputs: list[Output]) -> list[Output]:
        for ev in evaluators:
            outputs = [self.run_evaluator(ev, o) for o in outputs]
        return outputs

    def run_agents_layer(self, index: int, inputs: list[Output]) -> list[Output]:
        nodes = self._nodes(self.layers[index])
        agents = [n for n in nodes if n.type == "model"]
        evaluators = [n for n in nodes if n.type == "evaluator"]
        orch = self._orchestrator_before(index)

        if orch is not None and agents:
            if orch.type == "router":
                chosen = self.run_router(orch, agents, inputs)
                outputs = [self.run_producer(chosen, inputs)]
                return self._apply_evaluators(evaluators, outputs)

            assignments = self.run_controller(orch, agents, inputs)
            with ThreadPoolExecutor(max_workers=min(8, len(agents))) as pool:
                futures = [
                    pool.submit(
                        self.run_producer, a, inputs,
                        subtask=assignments.get(a.id), worker=True,
                    )
                    for a in agents
                ]
                outputs = [f.result() for f in futures]
            return self._apply_evaluators(evaluators, outputs)

        # Sequential chain; evaluators gate whatever precedes them
        current = inputs
        for node in nodes:
            if node.type in {"model", "aggregator"}:
                current = [self.run_producer(node, current)]
            elif node.type == "evaluator":
                current = [self.run_evaluator(node, o) for o in current]
        return current

    def run_aggregation_layer(self, index: int, inputs: list[Output]) -> list[Output]:
        aggs = [n for n in self._nodes(self.layers[index]) if n.type == "aggregator"]
        evaluators = [n for n in self._nodes(self.layers[index]) if n.type == "evaluator"]
        if not aggs:
            return inputs
        outputs = [self.run_producer(a, inputs) for a in aggs]
        return self._apply_evaluators(evaluators, outputs)

    def vote(self, outputs: list[Output]) -> Output:
        groups: dict[str, list[Output]] = {}
        for o in outputs:
            groups.setdefault(_vote_key(o.text), []).append(o)
        winner_key = max(groups, key=lambda k: len(groups[k]))  # ties: first seen
        winner = groups[winner_key][0]
        self._record(
            TraceStep(
                index=0,
                node_id="final-answer",
                node_name="Majority vote",
                node_type="output",
                kind="vote",
                output=winner.text,
                decision={
                    "tally": {
                        k: [o.node.name for o in v] for k, v in groups.items()
                    },
                    "winner": winner.node.name,
                },
            )
        )
        return winner

    def run(self) -> Output:
        if not any(n.type == "model" for n in self.config.nodes):
            raise RuntimeError("Configuration has no agent nodes to run.")
        # Fail before spending anything if any node's provider has no key
        for node in self.config.nodes:
            if node.type in LLM_NODE_TYPES:
                spec = self.spec_for(node)
                try:
                    require_provider(spec.provider, spec.model)
                except RuntimeError as exc:
                    raise RuntimeError(f"Node '{node.name}': {exc}") from exc
        current: list[Output] = []
        for i, layer in enumerate(self.layers):
            kind = layer.get("type")
            if kind == "agents":
                current = self.run_agents_layer(i, current)
            elif kind == "aggregation":
                current = self.run_aggregation_layer(i, current)
            # input / orchestration / tools / output: no standalone execution
        if not current:
            raise RuntimeError("Pipeline produced no output. Check that agents sit in an Agents layer.")
        return current[0] if len(current) == 1 else self.vote(current)


def _snapshot(config: AgentConfiguration, run: PipelineRun) -> AgentConfiguration:
    """Config as executed: resolved provider/model on every LLM node."""
    data = config.model_dump()
    for node in data.get("nodes") or []:
        if node.get("type") not in LLM_NODE_TYPES:
            continue
        spec = run.spec_for(ConfigurationNode.model_validate(node))
        settings_ = node.get("modelSettings") or {}
        settings_.update(provider=spec.provider, model=spec.model)
        node["modelSettings"] = settings_
    return AgentConfiguration.model_validate(data)


def run_pipeline(
    config: AgentConfiguration,
    task: Task,
    *,
    meter: RunMeter,
    model_override: str | None = None,
    parent_run_id: str | None = None,
) -> RunResult:
    if task.benchmark_id == "fab":
        # A research loop is many round trips per agent
        meter.max_calls = max(meter.max_calls or 0, settings()["fab_max_llm_calls"])
    run = PipelineRun(config, task, meter=meter, model_override=model_override)
    t0 = time.perf_counter()
    final = run.run()
    latency = time.perf_counter() - t0

    scored = score_task_output(task, final.text)
    evaluation = None
    score = None
    grading_cost = 0.0
    if task.benchmark_id == "fab":
        from app.benchmarks.fab_grading import grade

        evaluation = grade(
            task.question, final.text, task.metadata["rubric"], meter=meter,
            version=task.metadata.get("fab_version", "2.1"), commit=task.metadata.get("fab_commit"),
        )
        grading_cost = evaluation["grading_cost_usd"]
        if "error" not in evaluation:
            score = evaluation["partial_credit"]
            scored.success = evaluation["all_pass"]
            scored.note = (
                f"Partial credit {score:.0%}; {evaluation['criteria_passed']} of "
                f"{evaluation['criteria_total']} criteria"
                + ("; a must-pass criterion failed" if evaluation["dealbreaker_failed"] else "")
                + ("; the answer hedges" if evaluation["hedged"] else "")
                + ". Approximate jury, not the official one."
            )
        else:
            scored.note = evaluation["error"]
    llm_steps = [s for s in run.steps if s.model]
    models = list(dict.fromkeys(s.model for s in llm_steps if s.model))
    final_step = next(
        (s for s in reversed(run.steps) if s.node_id == final.node.id and s.kind in {"agent", "aggregator"}),
        None,
    )
    first_agent = run.default_model_node
    agent_nodes = {s.node_id for s in llm_steps}

    return RunResult(
        id=f"RUN-{uuid.uuid4().hex[:8].upper()}",
        mode="pipeline",
        benchmark_id=task.benchmark_id,
        task_id=task.id,
        configuration_id=config.id,
        configuration_name=config.name,
        architecture=config.architecture,
        model=", ".join(models),
        temperature=run.spec_for(first_agent).temperature if first_agent else 0.5,
        question=task.question,
        expected_answer=task.expected_answer,
        expected_display=task.expected_display,
        scored_answer=scored.scored_answer,
        reasoning=scored.reasoning,
        reasoning_comparison=scored.comparison,
        label_disputed=scored.label_disputed,
        answer=final.text,
        success=scored.success,
        score=score,
        evaluation=evaluation,
        latency_sec=round(latency, 3),
        prompt_tokens=sum(s.prompt_tokens for s in run.steps),
        completion_tokens=sum(s.completion_tokens for s in run.steps),
        cost_usd=round(sum(s.cost_usd for s in run.steps) + grading_cost, 6),
        note=(
            f"{meter.llm_calls} LLM calls across {len(agent_nodes)} nodes."
            + (f" {scored.note}" if scored.note else "")
        ),
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=final_step.system_prompt if final_step else None,
        user_prompt=final_step.user_prompt if final_step else None,
        configuration=_snapshot(config, run),
        parent_run_id=parent_run_id,
        status="completed",
        steps=run.steps,
        llm_calls=meter.llm_calls,
    )

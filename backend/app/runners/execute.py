from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import settings
from app.datasets.finqa_program import (
    declined,
    ends_in_percent,
    execute_program,
    extract_program,
    format_result,
    normalize_program,
    operation_sequence,
    strip_program_from_reasoning,
)
from app.datasets.registry import (
    Task,
    score_answer,
    split_reasoning_and_answer,
    system_prompt_for,
)
from app.llm import complete, infer_provider
from app.schemas import (
    AgentConfiguration,
    ClassifierPlan,
    FinQAReasoningComparison,
    RunResult,
)
from app.spend_guard import RunMeter


def _primary_model_node(config: AgentConfiguration):
    models = [n for n in config.nodes if n.type == "model" and n.modelSettings]
    if not models:
        return None
    return sorted(models, key=lambda n: n.order)[0]


def _resolve_model(config: AgentConfiguration, model_override: str | None) -> str:
    if model_override and model_override.strip():
        return model_override.strip()
    # Prefer the node's model unless it is a placeholder name
    node = _primary_model_node(config)
    if node and node.modelSettings and node.modelSettings.model:
        candidate = node.modelSettings.model.strip()
        if candidate.lower() not in {"gpt", "claude", "gemini", "model"}:
            return candidate
    return settings()["default_model"]


def _apply_prompt_and_model(
    config: AgentConfiguration,
    model: str,
    system_prompt: str,
) -> AgentConfiguration:
    """Snapshot with model + dataset system prompt filled in."""
    data = config.model_dump()
    nodes = data.get("nodes") or []
    for node in nodes:
        if node.get("type") == "model":
            settings = node.get("modelSettings") or {
                "provider": infer_provider(model),
                "model": model,
                "temperature": 0.5,
            }
            settings["provider"] = infer_provider(model)
            settings["model"] = model
            settings["systemPrompt"] = system_prompt
            node["modelSettings"] = settings
            break
    return AgentConfiguration.model_validate(data)


def _finqa_reasoning_comparison(
    task: Task,
    raw_answer: str,
) -> FinQAReasoningComparison | None:
    if task.benchmark_id != "finqa":
        return None
    expected_program = str(task.metadata.get("program") or "").strip()
    if not expected_program:
        return None

    agent_program = extract_program(raw_answer)
    comparison = FinQAReasoningComparison(
        expected_program=expected_program,
        agent_program=agent_program,
        expected_steps=list(task.metadata.get("steps") or []),
        expected_evidence=list(task.metadata.get("expected_evidence") or []),
        expected_result=task.expected_answer,
    )
    if not agent_program:
        comparison.parse_error = "The response did not include a Program line."
        return comparison
    if declined(agent_program):
        comparison.parse_error = "No program: the agent said the inputs were not in the evidence."
        return comparison

    execution = execute_program(
        agent_program,
        table=list(task.metadata.get("table") or []),
    )
    comparison.agent_result = format_result(execution.result)
    comparison.parse_error = execution.error
    try:
        comparison.program_exact_match = (
            normalize_program(agent_program) == normalize_program(expected_program)
        )
        comparison.operator_sequence_match = (
            operation_sequence(agent_program) == operation_sequence(expected_program)
        )
    except ValueError as exc:
        comparison.parse_error = str(exc)

    if comparison.agent_result is not None:
        # A program ending in ×100 produced a percent (6.485 for 0.06485): grade it as one.
        result = comparison.agent_result
        if ends_in_percent(agent_program) and result not in {"yes", "no"}:
            result = f"{result}%"
        comparison.execution_matches_expected = bool(
            score_answer(
                task.expected_answer,
                result,
                expected_is_percent=task.metadata.get("expected_is_percent"),
                expected_in_percent_units=bool(task.metadata.get("expected_in_percent_units")),
            )
        )
    return comparison


@dataclass
class ScoredOutput:
    reasoning: str | None
    scored_answer: str | None
    success: bool | None
    comparison: FinQAReasoningComparison | None
    note: str | None
    # The dataset contradicts itself for this question (see registry._finqa_task).
    label_disputed: bool = False


def score_task_output(task: Task, answer: str) -> ScoredOutput:
    """Split a final answer into reasoning/answer and score it against the task.

    Shared by every architecture so scoring never depends on how the answer was produced.
    """
    reasoning, scored = split_reasoning_and_answer(answer)
    comparison = _finqa_reasoning_comparison(task, answer)
    if comparison:
        reasoning = strip_program_from_reasoning(reasoning)
    if task.expected_answer is None and not scored:
        scored = None
    success = score_answer(
        task.expected_answer,
        answer,
        expected_is_percent=task.metadata.get("expected_is_percent"),
        expected_in_percent_units=bool(task.metadata.get("expected_in_percent_units")),
    )
    alternates = list(task.metadata.get("alternate_answers") or [])
    note = None if success is not None else "Open-ended task; success not auto-scored in MVP."
    if alternates:
        note = (
            f"Disputed label: FinQA's gold program gives {task.expected_answer}, but the "
            f"dataset also gives {' / '.join(alternates)}. Any of these is accepted."
        )
        # Lenient units here: annotations often drop the % sign.
        if success is False and any(score_answer(a, answer) for a in alternates):
            success = True
    return ScoredOutput(
        reasoning=reasoning,
        scored_answer=scored or None,
        success=success,
        comparison=comparison,
        note=note,
        label_disputed=bool(alternates),
    )


def task_user_prompt(task: Task) -> str:
    return f"{task.context}\n\nQuestion:\n{task.question}"

CLASSIFIER_SYSTEM = """You plan multi-agent layouts for enterprise tasks.
Return ONLY valid JSON with keys:
  roles: string[] (2-4 specialist role names)
  rationale: string (one short sentence)
  suggested_layout: string (one of: routing, orchestrator-workers, parallelization, prompt-chaining)
Do not execute the task. Do not invent tools. Keep roles concrete."""


def run_classifier_plan(
    config: AgentConfiguration,
    task: Task,
    *,
    meter: RunMeter,
    model_override: str | None = None,
    parent_run_id: str | None = None,
) -> RunResult:
    model = _resolve_model(config, model_override)
    dataset_prompt = system_prompt_for(task.benchmark_id)
    snapshot = _apply_prompt_and_model(config, model, dataset_prompt)
    user = (
        f"Configuration name: {config.name}\n"
        f"Declared architecture: {config.architecture}\n\n"
        f"Task context:\n{task.context[:1500]}\n\n"
        f"Task:\n{task.question}\n\n"
        "Propose specialist roles for a multi-agent attempt."
    )

    t0 = time.perf_counter()
    llm_result = complete(
        provider=infer_provider(model),
        model=model,
        system=CLASSIFIER_SYSTEM,
        user=user,
        temperature=0.5,
        before_call=meter.before_call,
    )
    meter.add_cost(llm_result.cost_usd)
    raw = llm_result.text
    prompt_tokens, completion_tokens = llm_result.prompt_tokens, llm_result.completion_tokens
    latency = time.perf_counter() - t0

    plan = ClassifierPlan(
        roles=["researcher", "analyst", "synthesizer"],
        rationale="Fallback plan; classifier JSON parse failed.",
        suggested_layout="orchestrator-workers",
    )
    try:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(raw[start : end + 1])
            plan = ClassifierPlan(
                roles=list(data.get("roles") or plan.roles),
                rationale=str(data.get("rationale") or plan.rationale),
                suggested_layout=str(
                    data.get("suggested_layout") or plan.suggested_layout
                ),
            )
    except Exception:
        pass

    return RunResult(
        id=f"RUN-{uuid.uuid4().hex[:8].upper()}",
        mode="classify-plan",
        benchmark_id=task.benchmark_id,
        task_id=task.id,
        configuration_id=config.id,
        configuration_name=config.name,
        architecture=config.architecture,
        model=model,
        temperature=0.5,
        question=task.question,
        expected_answer=task.expected_answer,
        expected_display=task.expected_display,
        scored_answer=None,
        answer=raw,
        success=None,
        latency_sec=round(latency, 3),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=round(llm_result.cost_usd, 6),
        classifier_plan=plan,
        note="Classifier only. Specialist agents are not executed yet.",
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=CLASSIFIER_SYSTEM,
        user_prompt=user,
        configuration=snapshot,
        parent_run_id=parent_run_id,
        status="completed",
        llm_calls=llm_result.calls,
    )

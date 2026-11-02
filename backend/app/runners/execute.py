from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import settings
from app.datasets.finqa_program import (
    execute_program,
    extract_program,
    format_result,
    normalize_program,
    operation_sequence,
    strip_program_from_reasoning,
)
from app.datasets.registry import (
    Task,
    response_format_for,
    score_answer,
    split_reasoning_and_answer,
    system_prompt_for,
)
from app.openai_client import chat_completion, estimate_cost
from app.schemas import (
    AgentConfiguration,
    ClassifierPlan,
    FinQAReasoningComparison,
    RunResult,
)


def _primary_model_node(config: AgentConfiguration):
    models = [n for n in config.nodes if n.type == "model" and n.modelSettings]
    if not models:
        return None
    return sorted(models, key=lambda n: n.order)[0]


def _system_prompt(config: AgentConfiguration, benchmark_id: str) -> str:
    # Dataset prompt is the source of truth so users only pick dataset + task.
    return system_prompt_for(benchmark_id)


def _temperature(config: AgentConfiguration) -> float:
    node = _primary_model_node(config)
    if node and node.modelSettings and node.modelSettings.temperature is not None:
        return float(node.modelSettings.temperature)
    return 0.5


def _resolve_model(config: AgentConfiguration, model_override: str | None) -> str:
    if model_override and model_override.strip():
        return model_override.strip()
    # Prefer explicit node model only if it looks like a real OpenAI id
    node = _primary_model_node(config)
    if node and node.modelSettings and node.modelSettings.model:
        candidate = node.modelSettings.model.strip()
        if candidate.lower() not in {"gpt", "claude", "gemini", "model"}:
            return candidate
    return settings()["openai_model"]


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
                "provider": "openai",
                "model": model,
                "temperature": 0.5,
            }
            settings["provider"] = "openai"
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
        comparison.execution_matches_expected = bool(
            score_answer(
                task.expected_answer,
                comparison.agent_result,
                expected_is_percent=task.metadata.get("expected_is_percent"),
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
    )
    return ScoredOutput(
        reasoning=reasoning,
        scored_answer=scored or None,
        success=success,
        comparison=comparison,
        note=(
            None
            if success is not None
            else "Open-ended task; success not auto-scored in MVP."
        ),
    )


def task_user_prompt(task: Task) -> str:
    return f"{task.context}\n\nQuestion:\n{task.question}"


def run_single_agent(
    config: AgentConfiguration,
    task: Task,
    *,
    model_override: str | None = None,
    parent_run_id: str | None = None,
) -> RunResult:
    model = _resolve_model(config, model_override)
    snapshot = _apply_prompt_and_model(config, model, system_prompt_for(task.benchmark_id))
    system = _system_prompt(config, task.benchmark_id)
    user = f"{task_user_prompt(task)}\n\n{response_format_for(task.benchmark_id)}"
    temp = _temperature(config)

    t0 = time.perf_counter()
    answer, prompt_tokens, completion_tokens = chat_completion(
        system=system,
        user=user,
        temperature=temp,
        model=model,
    )
    latency = time.perf_counter() - t0
    scored = score_task_output(task, answer)

    return RunResult(
        id=f"RUN-{uuid.uuid4().hex[:8].upper()}",
        mode="single-agent",
        benchmark_id=task.benchmark_id,
        task_id=task.id,
        configuration_id=config.id,
        configuration_name=config.name,
        architecture=config.architecture,
        model=model,
        temperature=temp,
        question=task.question,
        expected_answer=task.expected_answer,
        expected_display=task.expected_display,
        scored_answer=scored.scored_answer,
        reasoning=scored.reasoning,
        reasoning_comparison=scored.comparison,
        answer=answer,
        success=scored.success,
        latency_sec=round(latency, 3),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=round(estimate_cost(prompt_tokens, completion_tokens, model), 6),
        note=scored.note,
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=system,
        user_prompt=user,
        configuration=snapshot,
        parent_run_id=parent_run_id,
        status="completed",
    )


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
    raw, prompt_tokens, completion_tokens = chat_completion(
        system=CLASSIFIER_SYSTEM,
        user=user,
        temperature=0.5,
        model=model,
    )
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
        cost_usd=round(estimate_cost(prompt_tokens, completion_tokens, model), 6),
        classifier_plan=plan,
        note="Classifier only. Specialist agents are not executed yet.",
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=CLASSIFIER_SYSTEM,
        user_prompt=user,
        configuration=snapshot,
        parent_run_id=parent_run_id,
        status="completed",
    )

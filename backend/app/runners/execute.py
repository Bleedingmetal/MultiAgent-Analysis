from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.datasets.registry import Task, score_answer
from app.openai_client import chat_completion, estimate_cost
from app.schemas import AgentConfiguration, ClassifierPlan, RunResult


def _primary_model_node(config: AgentConfiguration):
    models = [n for n in config.nodes if n.type == "model" and n.modelSettings]
    if not models:
        return None
    return sorted(models, key=lambda n: n.order)[0]


def _system_prompt(config: AgentConfiguration) -> str:
    node = _primary_model_node(config)
    base = (
        "You are a careful single-agent assistant. "
        "Answer with the final result as clearly as possible. "
        "For numeric questions, put the final number on the last line."
    )
    if node and node.modelSettings and node.modelSettings.systemPrompt:
        return f"{node.modelSettings.systemPrompt}\n\n{base}"
    if node and node.metadata and node.metadata.get("instructions"):
        return f"{node.metadata['instructions']}\n\n{base}"
    if node and node.metadata and node.metadata.get("role"):
        return f"Role: {node.metadata['role']}\n\n{base}"
    return base


def _temperature(config: AgentConfiguration) -> float:
    node = _primary_model_node(config)
    if node and node.modelSettings and node.modelSettings.temperature is not None:
        return float(node.modelSettings.temperature)
    return 0.2


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


def _apply_model_to_config(
    config: AgentConfiguration, model: str
) -> AgentConfiguration:
    """Return a copy with primary model node updated for snapshot fidelity."""
    data = config.model_dump()
    nodes = data.get("nodes") or []
    for node in nodes:
        if node.get("type") == "model" and node.get("modelSettings"):
            node["modelSettings"]["model"] = model
            node["modelSettings"]["provider"] = "openai"
            break
    return AgentConfiguration.model_validate(data)


def run_single_agent(
    config: AgentConfiguration,
    task: Task,
    *,
    model_override: str | None = None,
    parent_run_id: str | None = None,
) -> RunResult:
    model = _resolve_model(config, model_override)
    snapshot = _apply_model_to_config(config, model)
    system = _system_prompt(config)
    user = (
        f"{task.context}\n\n"
        f"Question:\n{task.question}\n\n"
        "Respond with the answer. Prefer a short final answer."
    )
    temp = _temperature(config)

    t0 = time.perf_counter()
    answer, prompt_tokens, completion_tokens = chat_completion(
        system=system,
        user=user,
        temperature=temp,
        model=model,
    )
    latency = time.perf_counter() - t0
    success = score_answer(task.expected_answer, answer)

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
        answer=answer,
        success=success,
        latency_sec=round(latency, 3),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=round(estimate_cost(prompt_tokens, completion_tokens), 6),
        note=(
            None
            if success is not None
            else "Open-ended task; success not auto-scored in MVP."
        ),
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
    snapshot = _apply_model_to_config(config, model)
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
        temperature=0.2,
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
        temperature=0.2,
        question=task.question,
        expected_answer=task.expected_answer,
        answer=raw,
        success=None,
        latency_sec=round(latency, 3),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=round(estimate_cost(prompt_tokens, completion_tokens), 6),
        classifier_plan=plan,
        note="Classifier only. Specialist agents are not executed yet.",
        created_at=datetime.now(timezone.utc).isoformat(),
        system_prompt=CLASSIFIER_SYSTEM,
        user_prompt=user,
        configuration=snapshot,
        parent_run_id=parent_run_id,
        status="completed",
    )

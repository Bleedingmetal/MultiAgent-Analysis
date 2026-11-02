"""Sequential prompt-chain execution.

A chain is an ordered list of agent steps (model nodes). Each step has its own
model, an editable prompt template, and a choice of inputs (original task and/or
earlier outputs). Steps run one after another; every step is recorded as a
`ChainStepTrace` inside the parent `RunResult`.

Nothing here knows about a specific benchmark. Dataset specifics reach the chain
only through `system_prompt_for` / `response_format_for` (appended to the final
step) and `score_task_output` (applied to the final answer).
"""

from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.config import settings
from app.datasets.registry import Task, response_format_for, system_prompt_for
from app.openai_client import chat_completion, estimate_cost, get_client, truncate_prompt
from app.runners.execute import score_task_output, task_user_prompt
from app.schemas import (
    AgentConfiguration,
    ChainStepTrace,
    ConfigurationNode,
    ModelSettings,
    PromptStepSettings,
    RunResult,
)

# Providers with an execution integration. Mirrors EXECUTABLE_PROVIDERS in the
# frontend (src/lib/provider-models.ts).
SUPPORTED_PROVIDERS = {"openai"}
_PLACEHOLDER_MODELS = {"gpt", "claude", "gemini", "model"}

KNOWN_ROLE_LABELS = {
    "researcher": "Researcher",
    "analyst": "Analyst",
    "verifier": "Verifier",
}

# Variables a prompt template may use, written as {{name}}.
TEMPLATE_VARIABLES = (
    "role",
    "objective",
    "instructions",
    "output_requirements",
    "dataset_instructions",
)

# Used when a step has no template of its own (e.g. a hand-written config).
DEFAULT_TEMPLATE = (
    "Your role in this sequential chain of agents: {{role}}.\n\n"
    "Objective: {{objective}}\n\n"
    "{{instructions}}\n\n"
    "{{output_requirements}}"
)

# Headings used when a value exists but the template has no placeholder for it,
# so a user can never lose an objective/instruction by editing the template.
_APPENDED_SECTIONS: tuple[tuple[str, str | None], ...] = (
    ("objective", "Objective:"),
    ("instructions", "Instructions:"),
    ("output_requirements", None),
    ("dataset_instructions", "Answer format required for the final output:"),
)

STRUCTURED_KEYS = ("summary", "facts", "calculations", "evidence", "answer")
_LIST_KEYS = ("facts", "calculations", "evidence")

_TEXT_INTERMEDIATE = (
    "Respond in plain text. Keep it concise and self-contained, because the next "
    "agent will read it."
)
_TEXT_FINAL = "Your response is the final output of the chain."
_STRUCTURED = (
    "Respond with a single JSON object and nothing else (no markdown fences). "
    "Use exactly these keys:\n"
    '- "summary": string. A brief, verifiable justification of your findings '
    "(not a step-by-step account of your thinking).\n"
    '- "facts": array of strings. Facts taken from the inputs, with units.\n'
    '- "calculations": array of strings. Each intermediate calculation as '
    '"expression = result" so it can be re-checked.\n'
    '- "evidence": array of strings. Short verbatim snippets from the inputs '
    "that support the facts.\n"
    '- "answer": string or null. Your current best answer, if you have one.\n'
    "Use an empty array when a list does not apply."
)

_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
_FENCE = re.compile(r"^```[A-Za-z0-9_-]*[ \t]*\n?(.*?)\n?```\s*$", re.DOTALL)


class ChainConfigError(ValueError):
    """The configuration cannot be executed as a prompt chain (client error)."""


@dataclass
class ResolvedStep:
    node_id: str
    name: str
    role: str
    objective: str
    instructions: str
    template: str
    include_task: bool
    previous_outputs: str  # "none" | "last" | "all"
    output_format: str  # "text" | "structured"
    provider: str
    model: str
    temperature: float
    max_tokens: int

    @property
    def role_label(self) -> str:
        return KNOWN_ROLE_LABELS.get(self.role.strip().lower()) or self.name


@dataclass
class StepOutput:
    """What a finished step hands to later steps."""

    index: int
    label: str
    text: str


# --------------------------------------------------------------------------
# Resolving the configuration
# --------------------------------------------------------------------------


def _model_id(settings_model: str | None, override: str | None) -> str:
    if override and override.strip():
        return override.strip()
    candidate = (settings_model or "").strip()
    if candidate and candidate.lower() not in _PLACEHOLDER_MODELS:
        return candidate
    return settings()["openai_model"]


def _legacy_prompt_step(node: ConfigurationNode, ms: ModelSettings) -> PromptStepSettings:
    """Saved chains created before prompt steps existed: keep any text they had."""
    metadata = node.metadata or {}
    instructions = metadata.get("instructions") or ms.systemPrompt or ""
    return PromptStepSettings(role="custom", instructions=str(instructions))


def resolve_chain(
    config: AgentConfiguration, model_override: str | None = None
) -> list[ResolvedStep]:
    """Ordered executable steps from a configuration, or ChainConfigError."""
    layer_order: dict[str, int] = {}
    for layer in config.layers:
        try:
            layer_order[str(layer.get("id"))] = int(layer.get("order") or 0)
        except (TypeError, ValueError):
            layer_order[str(layer.get("id"))] = 0

    nodes = [n for n in config.nodes if n.type == "model"]
    nodes.sort(key=lambda n: (layer_order.get(n.layerId, 0), n.order))
    if not nodes:
        raise ChainConfigError("A prompt chain needs at least one agent step.")

    cap_steps = settings()["max_chain_steps"]
    if len(nodes) > cap_steps:
        raise ChainConfigError(
            f"A prompt chain can have at most {cap_steps} steps (this one has {len(nodes)}). "
            "Raise MAX_CHAIN_STEPS to allow more."
        )

    token_cap = settings()["max_completion_tokens"]
    steps: list[ResolvedStep] = []
    for i, node in enumerate(nodes):
        ms = node.modelSettings or ModelSettings()
        provider = "openai" if model_override else (ms.provider or "openai").strip().lower()
        if provider not in SUPPORTED_PROVIDERS:
            supported = ", ".join(sorted(SUPPORTED_PROVIDERS))
            raise ChainConfigError(
                f"Step {i + 1} ({node.name}) uses provider '{provider}', which cannot run yet. "
                f"Supported: {supported}."
            )
        ps = node.promptStep or _legacy_prompt_step(node, ms)
        temperature = 0.5 if ms.temperature is None else float(ms.temperature)
        max_tokens = (
            min(int(ms.maxTokens), token_cap)
            if ms.maxTokens and ms.maxTokens > 0
            else token_cap
        )
        steps.append(
            ResolvedStep(
                node_id=node.id,
                name=node.name or f"Step {i + 1}",
                role=ps.role or "custom",
                objective=ps.objective.strip(),
                instructions=ps.instructions.strip(),
                template=ps.promptTemplate.strip(),
                include_task=ps.inputs.task,
                previous_outputs=ps.inputs.previousOutputs,
                output_format=ps.outputFormat,
                provider=provider,
                model=_model_id(ms.model, model_override),
                temperature=max(0.0, min(2.0, temperature)),
                max_tokens=max_tokens,
            )
        )
    return steps


# --------------------------------------------------------------------------
# Prompt rendering
# --------------------------------------------------------------------------


def output_requirements(output_format: str, is_last: bool) -> str:
    if output_format == "structured" and not is_last:
        return _STRUCTURED
    return _TEXT_FINAL if is_last else _TEXT_INTERMEDIATE


def render_system_prompt(
    step: ResolvedStep, *, is_last: bool, dataset_instructions: str
) -> tuple[str, list[str]]:
    """Fill a step's template. Returns the prompt and any non-fatal warnings."""
    effective_format = "text" if is_last else step.output_format
    values = {
        "role": step.role_label,
        "objective": step.objective,
        "instructions": step.instructions,
        "output_requirements": output_requirements(effective_format, is_last),
        "dataset_instructions": dataset_instructions if is_last else "",
    }
    template = step.template or DEFAULT_TEMPLATE

    used = {m.group(1) for m in _PLACEHOLDER.finditer(template)}
    warnings = [
        "Unknown template variable '{{" + name + "}}' was left as written."
        for name in sorted(used - set(TEMPLATE_VARIABLES))
    ]

    # Single pass: values are never re-scanned, so user text containing "{{x}}" is safe.
    text = _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), template)

    for name, heading in _APPENDED_SECTIONS:
        value = values[name]
        if value and name not in used:
            text += f"\n\n{heading}\n{value}" if heading else f"\n\n{value}"

    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text, warnings


def select_inputs(step: ResolvedStep, outputs: list[StepOutput]) -> list[StepOutput]:
    if step.previous_outputs == "all":
        return list(outputs)
    if step.previous_outputs == "last":
        return outputs[-1:]
    return []


def render_user_prompt(
    step: ResolvedStep, task: Task, inputs: list[StepOutput]
) -> tuple[str, list[str]]:
    """Labelled input blocks: the original task and/or earlier step outputs."""
    parts: list[str] = []
    if step.include_task:
        parts.append("## Original task\n" + task_user_prompt(task))
    for item in inputs:
        parts.append(f"## Output of step {item.index + 1} ({item.label})\n{item.text}")
    if not parts:
        return (
            "No input was provided to this step. Follow your instructions as written.",
            ["This step received no inputs (task and previous outputs are both off)."],
        )
    return "\n\n".join(parts), []


# --------------------------------------------------------------------------
# Structured output
# --------------------------------------------------------------------------


def parse_structured_output(text: str) -> tuple[dict[str, Any] | None, str | None]:
    """Parse the JSON envelope. Returns (object, problem); problem is None when valid."""
    body = text.strip()
    fenced = _FENCE.match(body)
    if fenced:
        body = fenced.group(1).strip()
    try:
        value = json.loads(body)
    except json.JSONDecodeError:
        start, end = body.find("{"), body.rfind("}")
        if start == -1 or end <= start:
            return None, "Response is not valid JSON."
        try:
            value = json.loads(body[start : end + 1])
        except json.JSONDecodeError as exc:
            return None, f"Response is not valid JSON ({exc.msg})."
    if not isinstance(value, dict):
        return None, "Expected a JSON object."

    problems: list[str] = []
    if not any(k in value for k in STRUCTURED_KEYS):
        problems.append(
            "none of the expected keys (" + ", ".join(STRUCTURED_KEYS) + ") were present"
        )
    for key in _LIST_KEYS:
        if key in value and not isinstance(value[key], list):
            problems.append(f"'{key}' must be a list")
    for key in ("summary", "answer"):
        if key in value and value[key] is not None and not isinstance(value[key], str):
            problems.append(f"'{key}' must be a string or null")
    return value, ("Invalid structured output: " + "; ".join(problems)) if problems else None


# --------------------------------------------------------------------------
# Execution
# --------------------------------------------------------------------------


def _short_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:500]


def _skipped_trace(
    run_id: str, index: int, step: ResolvedStep, reason: str
) -> ChainStepTrace:
    return ChainStepTrace(
        id=f"{run_id}-S{index + 1}",
        run_id=run_id,
        index=index,
        node_id=step.node_id,
        name=step.name,
        role=step.role,
        objective=step.objective,
        provider=step.provider,
        model=step.model,
        temperature=step.temperature,
        max_tokens=step.max_tokens,
        output_format=step.output_format,  # type: ignore[arg-type]
        status="skipped",
        include_task=step.include_task,
        warnings=[f"Not run: {reason}"],
    )


def run_prompt_chain(
    config: AgentConfiguration,
    task: Task,
    *,
    model_override: str | None = None,
    parent_run_id: str | None = None,
    complete: Callable[..., tuple[str, int, int]] | None = None,
    budget_usd: float | None = None,
) -> RunResult:
    """Run a configuration as a sequential chain and return one traced RunResult.

    `complete` is the model call (defaults to the OpenAI integration) and exists so
    tests can substitute a fake. `budget_usd` stops the chain before a later step if
    the chain has already spent that much.
    """
    steps = resolve_chain(config, model_override)
    if complete is None:
        get_client()  # fail fast (before any trace exists) if no API key is configured
        complete = chat_completion

    run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
    dataset_instructions = (
        f"{system_prompt_for(task.benchmark_id)}\n\n{response_format_for(task.benchmark_id)}"
    )
    max_system = settings()["max_system_chars"]

    traces: list[ChainStepTrace] = []
    outputs: list[StepOutput] = []
    stop_reason: str | None = None
    total_cost = 0.0
    t_run = time.perf_counter()

    for index, step in enumerate(steps):
        if stop_reason:
            traces.append(_skipped_trace(run_id, index, step, stop_reason))
            continue
        if index > 0 and budget_usd is not None and total_cost >= budget_usd:
            stop_reason = (
                f"the chain reached the remaining spend budget (${budget_usd:.4f}) "
                f"before step {index + 1}"
            )
            traces.append(_skipped_trace(run_id, index, step, stop_reason))
            continue

        is_last = index == len(steps) - 1
        effective_format = "text" if is_last else step.output_format
        system, warnings = render_system_prompt(
            step, is_last=is_last, dataset_instructions=dataset_instructions
        )
        inputs = select_inputs(step, outputs)
        user, user_warnings = render_user_prompt(step, task, inputs)
        warnings += user_warnings
        if is_last and step.output_format == "structured":
            warnings.append(
                "The final step runs as text so its answer can be scored; "
                "structured output was ignored."
            )
        # Record what the model will actually see (spend-safety truncation included).
        sent_system = truncate_prompt(system, max_system)
        sent_user = truncate_prompt(user)
        truncated = sent_system != system or sent_user != user
        if truncated:
            warnings.append("Prompt exceeded the length limit and was truncated.")

        trace = ChainStepTrace(
            id=f"{run_id}-S{index + 1}",
            run_id=run_id,
            index=index,
            node_id=step.node_id,
            name=step.name,
            role=step.role,
            objective=step.objective,
            provider=step.provider,
            model=step.model,
            temperature=step.temperature,
            max_tokens=step.max_tokens,
            output_format=effective_format,  # type: ignore[arg-type]
            status="completed",
            include_task=step.include_task,
            input_step_indexes=[item.index for item in inputs],
            system_prompt=sent_system,
            user_prompt=sent_user,
            prompt_truncated=truncated,
            warnings=warnings,
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        traces.append(trace)

        t_step = time.perf_counter()
        try:
            text, prompt_tokens, completion_tokens = complete(
                system=sent_system,
                user=sent_user,
                temperature=step.temperature,
                model=step.model,
                max_tokens=step.max_tokens,
            )
        except Exception as exc:  # API failure, rate limit, bad model id, ...
            trace.latency_sec = round(time.perf_counter() - t_step, 3)
            trace.status = "error"
            trace.error = _short_error(exc)
            stop_reason = f"step {index + 1} ({step.name}) failed"
            continue

        trace.latency_sec = round(time.perf_counter() - t_step, 3)
        trace.prompt_tokens = prompt_tokens
        trace.completion_tokens = completion_tokens
        trace.cost_usd = round(estimate_cost(prompt_tokens, completion_tokens, step.model), 6)
        total_cost += trace.cost_usd
        trace.response = text

        if not text.strip():
            trace.status = "error"
            trace.error = "The model returned an empty response."
            stop_reason = f"step {index + 1} ({step.name}) returned an empty response"
            continue

        passed_text = text
        if effective_format == "structured":
            parsed, problem = parse_structured_output(text)
            trace.structured_output = parsed
            if problem:
                trace.status = "invalid_output"
                trace.parse_error = problem
                trace.warnings.append(
                    "Raw text was passed to the next step because the output was not valid."
                )
            elif parsed is not None:
                passed_text = json.dumps(parsed, indent=2, ensure_ascii=False)
        outputs.append(StepOutput(index=index, label=step.role_label, text=passed_text))

    latency = time.perf_counter() - t_run
    return _assemble_result(
        run_id=run_id,
        config=config,
        task=task,
        steps=steps,
        traces=traces,
        latency=latency,
        stop_reason=stop_reason,
        parent_run_id=parent_run_id,
    )


def _assemble_result(
    *,
    run_id: str,
    config: AgentConfiguration,
    task: Task,
    steps: list[ResolvedStep],
    traces: list[ChainStepTrace],
    latency: float,
    stop_reason: str | None,
    parent_run_id: str | None,
) -> RunResult:
    notes: list[str] = []
    failed = next((t for t in traces if t.status == "error"), None)
    complete = stop_reason is None and all(t.status in {"completed", "invalid_output"} for t in traces)

    answer = ""
    scored = None
    error = None
    if complete:
        answer = traces[-1].response or ""
        scored = score_task_output(task, answer)
        if scored.note:
            notes.append(scored.note)
        invalid = [t.index + 1 for t in traces if t.status == "invalid_output"]
        if invalid:
            joined = ", ".join(str(i) for i in invalid)
            notes.append(f"Step {joined} returned invalid structured output; raw text was used.")
    else:
        if failed:
            error = f"Step {failed.index + 1} ({failed.name}) failed: {failed.error}"
        else:
            error = f"Chain stopped early: {stop_reason}."
        ran = sum(1 for t in traces if t.status != "skipped")
        notes.append(f"Incomplete: {ran} of {len(traces)} steps ran. No final answer was produced.")

    models: list[str] = []
    for step in steps:
        if step.model not in models:
            models.append(step.model)

    return RunResult(
        id=run_id,
        mode="prompt-chain",
        benchmark_id=task.benchmark_id,
        task_id=task.id,
        configuration_id=config.id,
        configuration_name=config.name,
        architecture=config.architecture,
        model=" + ".join(models),
        temperature=steps[0].temperature,
        question=task.question,
        expected_answer=task.expected_answer,
        expected_display=task.expected_display,
        scored_answer=scored.scored_answer if scored else None,
        reasoning=scored.reasoning if scored else None,
        reasoning_comparison=scored.comparison if scored else None,
        answer=answer,
        success=scored.success if scored else None,
        latency_sec=round(latency, 3),
        prompt_tokens=sum(t.prompt_tokens for t in traces),
        completion_tokens=sum(t.completion_tokens for t in traces),
        cost_usd=round(sum(t.cost_usd for t in traces), 6),
        note=" ".join(notes) or None,
        created_at=datetime.now(timezone.utc).isoformat(),
        configuration=config,
        parent_run_id=parent_run_id,
        status="completed" if complete else "incomplete",
        error=error,
        steps=traces,
    )

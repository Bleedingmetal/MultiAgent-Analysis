"""LLM routing: Input → Router → one specialist → Output.

Reuses prompt rendering and scoring from prompt_chain. Dataset-specific text
reaches specialists only via the final-step dataset instructions block.
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
from app.llm import infer_provider
from app.openai_client import chat_completion, estimate_cost, get_client, truncate_prompt
from app.runners.execute import score_task_output, task_user_prompt
from app.runners.prompt_chain import (
    DEFAULT_TEMPLATE,
    KNOWN_ROLE_LABELS,
    ResolvedStep,
    _model_id,
    check_provider,
    _short_error,
    output_requirements,
    render_system_prompt,
    render_user_prompt,
)
from app.schemas import (
    AgentConfiguration,
    ChainStepTrace,
    ConfigurationNode,
    ModelSettings,
    PromptStepSettings,
    RouterSettings,
    RunResult,
)

_PLACEHOLDER_MODELS = {"gpt", "claude", "gemini", "model"}
_FENCE = re.compile(r"^```[A-Za-z0-9_-]*[ \t]*\n?(.*?)\n?```\s*$", re.DOTALL)

DEFAULT_ROUTER_TEMPLATE = (
    "You are a routing agent. Your only job is to choose which specialist should "
    "handle the incoming task. You must not answer the task yourself.\n\n"
    "{{instructions}}\n\n"
    "{{output_requirements}}"
)

ROUTER_OUTPUT_REQUIREMENTS = (
    "Respond with a single JSON object and nothing else (no markdown fences). "
    'Use exactly these keys:\n'
    '- "selected_route": string. Must be one of the route ids listed in the user message.\n'
    '- "explanation": string. A concise, verifiable reason for the choice '
    "(what in the task matched the route description)."
)

ROLE_ROUTE_DESCRIPTIONS: dict[str, str] = {
    "researcher": (
        "Select when the task is mainly about finding facts, quotes, evidence, or "
        "extracting information from provided context."
    ),
    "analyst": (
        "Select when the task requires calculations, numeric reasoning, comparisons, "
        "or deriving an answer from evidence."
    ),
    "verifier": (
        "Select when the task is to check work, confirm correctness, or produce a "
        "final validated answer from prior reasoning."
    ),
    "custom": "Select when this specialist's objective and description best match the task.",
}


class RoutingConfigError(ValueError):
    """The configuration cannot be executed as routing (client error)."""


@dataclass
class ResolvedRoute:
    node_id: str
    name: str
    route_id: str
    role: str
    objective: str
    route_description: str
    instructions: str
    template: str
    provider: str
    model: str
    temperature: float
    max_tokens: int

    @property
    def role_label(self) -> str:
        return KNOWN_ROLE_LABELS.get(self.role.strip().lower()) or self.name


@dataclass
class ResolvedRouter:
    node_id: str
    name: str
    instructions: str
    template: str
    fallback_route_id: str
    provider: str
    model: str
    temperature: float
    max_tokens: int


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    cleaned = cleaned.strip("-")
    return cleaned or "route"


def default_route_id(node: ConfigurationNode, role: str, index: int) -> str:
    explicit = (node.promptStep.routeId if node.promptStep else "") or ""
    if explicit.strip():
        return _slug(explicit)
    role_slug = _slug(role)
    if role_slug and role_slug != "custom":
        return role_slug
    return _slug(node.id) or f"route-{index + 1}"


def default_route_description(
    role: str, objective: str, name: str, explicit: str = ""
) -> str:
    if explicit.strip():
        return explicit.strip()
    base = ROLE_ROUTE_DESCRIPTIONS.get(role.strip().lower(), ROLE_ROUTE_DESCRIPTIONS["custom"])
    parts = [base]
    if objective.strip():
        parts.append(f"Objective: {objective.strip()}")
    if name.strip():
        parts.append(f"Specialist name: {name.strip()}")
    return " ".join(parts)


def _legacy_prompt_step(node: ConfigurationNode, ms: ModelSettings) -> PromptStepSettings:
    metadata = node.metadata or {}
    instructions = metadata.get("instructions") or ms.systemPrompt or ""
    return PromptStepSettings(role="custom", instructions=str(instructions))


def _router_settings(node: ConfigurationNode) -> RouterSettings:
    if node.routerSettings:
        return node.routerSettings
    return RouterSettings()


def resolve_routing(
    config: AgentConfiguration, model_override: str | None = None, require_keys: bool = False
) -> tuple[ResolvedRouter, list[ResolvedRoute]]:
    layer_order: dict[str, int] = {}
    for layer in config.layers:
        try:
            layer_order[str(layer.get("id"))] = int(layer.get("order") or 0)
        except (TypeError, ValueError):
            layer_order[str(layer.get("id"))] = 0

    routers = [n for n in config.nodes if n.type == "router"]
    if len(routers) != 1:
        raise RoutingConfigError("Routing needs exactly one Router node.")
    router_node = routers[0]

    routes_nodes = [n for n in config.nodes if n.type == "model"]
    routes_nodes.sort(key=lambda n: (layer_order.get(n.layerId, 0), n.order))
    if not routes_nodes:
        raise RoutingConfigError("Routing needs at least one specialist agent.")

    cap = settings()["max_chain_steps"]
    if len(routes_nodes) > cap:
        raise RoutingConfigError(
            f"Routing supports at most {cap} specialists (this one has {len(routes_nodes)})."
        )

    token_cap = settings()["max_completion_tokens"]
    routes: list[ResolvedRoute] = []
    seen_ids: set[str] = set()

    for index, node in enumerate(routes_nodes):
        ms = node.modelSettings or ModelSettings()
        provider = (
            infer_provider(model_override.strip())
            if model_override and model_override.strip()
            else (ms.provider or "openai").strip().lower()
        )
        check_provider(provider, f"Route {index + 1} ({node.name})", RoutingConfigError, require_keys)
        ps = node.promptStep or _legacy_prompt_step(node, ms)
        route_id = default_route_id(node, ps.role or "custom", index)
        if route_id in seen_ids:
            raise RoutingConfigError(
                f"Duplicate route id '{route_id}'. Each specialist needs a unique route id."
            )
        seen_ids.add(route_id)
        temperature = 0.3 if ms.temperature is None else float(ms.temperature)
        max_tokens = (
            min(int(ms.maxTokens), token_cap)
            if ms.maxTokens and ms.maxTokens > 0
            else token_cap
        )
        routes.append(
            ResolvedRoute(
                node_id=node.id,
                name=node.name or f"Route {index + 1}",
                route_id=route_id,
                role=ps.role or "custom",
                objective=ps.objective.strip(),
                instructions=ps.instructions.strip(),
                route_description=default_route_description(
                    ps.role or "custom",
                    ps.objective,
                    node.name or "",
                    ps.routeDescription,
                ),
                template=ps.promptTemplate.strip(),
                provider=provider,
                model=_model_id(ms.model, model_override, provider),
                temperature=max(0.0, min(2.0, temperature)),
                max_tokens=max_tokens,
            )
        )

    rms = router_node.modelSettings or ModelSettings()
    r_provider = (
        infer_provider(model_override.strip())
        if model_override and model_override.strip()
        else (rms.provider or "openai").strip().lower()
    )
    check_provider(r_provider, "The Router", RoutingConfigError, require_keys)
    rs = _router_settings(router_node)
    r_temp = 0.2 if rms.temperature is None else float(rms.temperature)
    r_max = (
        min(int(rms.maxTokens), token_cap)
        if rms.maxTokens and rms.maxTokens > 0
        else min(512, token_cap)
    )
    fallback = _slug(rs.fallbackRouteId) if rs.fallbackRouteId else ""
    if fallback and fallback not in seen_ids:
        fallback = ""

    router = ResolvedRouter(
        node_id=router_node.id,
        name=router_node.name or "Router",
        instructions=rs.instructions.strip(),
        template=rs.promptTemplate.strip() or DEFAULT_ROUTER_TEMPLATE,
        fallback_route_id=fallback,
        provider=r_provider,
        model=_model_id(rms.model, model_override, r_provider),
        temperature=max(0.0, min(1.0, r_temp)),
        max_tokens=r_max,
    )
    return router, routes


def render_router_system(router: ResolvedRouter) -> str:
    values = {
        "instructions": router.instructions
        or (
            "Read the task and the route catalog. Pick exactly one route id that best "
            "matches the task. Do not solve the task."
        ),
        "output_requirements": ROUTER_OUTPUT_REQUIREMENTS,
    }
    text = router.template
    if "{{instructions}}" in text or "{{output_requirements}}" in text:
        text = text.replace("{{instructions}}", values["instructions"])
        text = text.replace("{{output_requirements}}", values["output_requirements"])
    else:
        text = f"{text}\n\n{values['output_requirements']}"
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def render_router_user(task: Task, routes: list[ResolvedRoute]) -> str:
    catalog_lines = []
    for route in routes:
        catalog_lines.append(
            f"- id: {route.route_id}\n"
            f"  name: {route.name}\n"
            f"  role: {route.role_label}\n"
            f"  description: {route.route_description}"
        )
    catalog = "\n".join(catalog_lines)
    return (
        "## Original task\n"
        f"{task_user_prompt(task)}\n\n"
        "## Available routes\n"
        f"{catalog}\n\n"
        "Choose the single best route id for this task."
    )


def parse_router_decision(text: str) -> tuple[dict[str, Any] | None, str | None]:
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
    selected = value.get("selected_route")
    explanation = value.get("explanation")
    if not isinstance(selected, str) or not selected.strip():
        return None, "'selected_route' must be a non-empty string."
    if explanation is not None and not isinstance(explanation, str):
        return None, "'explanation' must be a string."
    return value, None


def pick_route(
    routes: list[ResolvedRoute],
    decision: dict[str, Any] | None,
    *,
    fallback_route_id: str,
) -> tuple[ResolvedRoute | None, str, list[str]]:
    """Return (route, warnings joined, available ids)."""
    available = [r.route_id for r in routes]
    warnings: list[str] = []
    if not decision:
        if len(routes) == 1:
            warnings.append("Router output was invalid; only one route exists, using it.")
            return routes[0], "; ".join(warnings), available
        if fallback_route_id:
            match = next((r for r in routes if r.route_id == fallback_route_id), None)
            if match:
                warnings.append(
                    f"Router output was invalid; using configured fallback '{fallback_route_id}'."
                )
                return match, "; ".join(warnings), available
        return None, "Router output was invalid and no fallback route applied.", available

    raw = _slug(str(decision.get("selected_route", "")))
    match = next((r for r in routes if r.route_id == raw), None)
    if match:
        return match, "", available

    warnings.append(f"Router selected unknown route '{raw}'.")
    if fallback_route_id:
        fb = next((r for r in routes if r.route_id == fallback_route_id), None)
        if fb:
            warnings.append(f"Using fallback route '{fallback_route_id}'.")
            return fb, "; ".join(warnings), available
    if len(routes) == 1:
        warnings.append("Using the only configured route.")
        return routes[0], "; ".join(warnings), available
    return None, "; ".join(warnings), available


def _route_to_step(route: ResolvedRoute) -> ResolvedStep:
    return ResolvedStep(
        node_id=route.node_id,
        name=route.name,
        role=route.role,
        objective=route.objective,
        instructions=route.instructions,
        template=route.template or DEFAULT_TEMPLATE,
        include_task=True,
        previous_outputs="none",
        output_format="text",
        provider=route.provider,
        model=route.model,
        temperature=route.temperature,
        max_tokens=route.max_tokens,
    )


def run_routing(
    config: AgentConfiguration,
    task: Task,
    *,
    model_override: str | None = None,
    parent_run_id: str | None = None,
    complete: Callable[..., tuple[str, int, int]] | None = None,
) -> RunResult:
    router, routes = resolve_routing(config, model_override)
    if complete is None:
        get_client()
        complete = chat_completion

    run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
    dataset_instructions = (
        f"{system_prompt_for(task.benchmark_id)}\n\n{response_format_for(task.benchmark_id)}"
    )
    max_system = settings()["max_system_chars"]
    traces: list[ChainStepTrace] = []
    t_run = time.perf_counter()
    stop_reason: str | None = None
    total_cost = 0.0
    available_ids = [r.route_id for r in routes]

    # --- Router step ---
    router_system = render_router_system(router)
    router_user = render_router_user(task, routes)
    sent_router_system = truncate_prompt(router_system, max_system)
    sent_router_user = truncate_prompt(router_user)
    router_trace = ChainStepTrace(
        id=f"{run_id}-R1",
        run_id=run_id,
        index=0,
        node_id=router.node_id,
        name=router.name,
        role="router",
        step_kind="router",
        available_routes=available_ids,
        provider=router.provider,
        model=router.model,
        temperature=router.temperature,
        max_tokens=router.max_tokens,
        output_format="structured",
        status="completed",
        include_task=True,
        system_prompt=sent_router_system,
        user_prompt=sent_router_user,
        prompt_truncated=sent_router_system != router_system or sent_router_user != router_user,
        started_at=datetime.now(timezone.utc).isoformat(),
    )
    traces.append(router_trace)

    t_router = time.perf_counter()
    try:
        router_text, p_tok, c_tok = complete(
            system=sent_router_system,
            user=sent_router_user,
            temperature=router.temperature,
            model=router.model,
            max_tokens=router.max_tokens,
        )
    except Exception as exc:
        router_trace.latency_sec = round(time.perf_counter() - t_router, 3)
        router_trace.status = "error"
        router_trace.error = _short_error(exc)
        return _assemble_result(
            run_id=run_id,
            config=config,
            task=task,
            router=router,
            routes=routes,
            traces=traces,
            latency=time.perf_counter() - t_run,
            stop_reason=f"Router failed: {router_trace.error}",
            parent_run_id=parent_run_id,
        )

    router_trace.latency_sec = round(time.perf_counter() - t_router, 3)
    router_trace.prompt_tokens = p_tok
    router_trace.completion_tokens = c_tok
    router_trace.cost_usd = round(estimate_cost(p_tok, c_tok, router.model), 6)
    total_cost += router_trace.cost_usd
    router_trace.response = router_text

    decision, parse_problem = parse_router_decision(router_text)
    if parse_problem:
        router_trace.status = "invalid_output"
        router_trace.parse_error = parse_problem
        router_trace.structured_output = decision
    else:
        router_trace.structured_output = decision

    selected, pick_warnings, _ = pick_route(
        routes, decision, fallback_route_id=router.fallback_route_id
    )
    explanation = (
        str(decision.get("explanation", "")).strip() if isinstance(decision, dict) else ""
    )
    if selected:
        router_trace.selected_route = selected.route_id
        router_trace.routing_explanation = explanation or None
        if pick_warnings:
            router_trace.warnings.append(pick_warnings)
        if router_trace.status == "invalid_output":
            router_trace.warnings.append(
                "Routing decision was recovered using fallback policy."
            )
    else:
        router_trace.status = "error"
        router_trace.error = pick_warnings or "No valid route selected."
        stop_reason = router_trace.error
        return _assemble_result(
            run_id=run_id,
            config=config,
            task=task,
            router=router,
            routes=routes,
            traces=traces,
            latency=time.perf_counter() - t_run,
            stop_reason=stop_reason,
            parent_run_id=parent_run_id,
        )

    # --- Specialist step (only the selected route runs) ---
    assert selected is not None
    step = _route_to_step(selected)
    system, warnings = render_system_prompt(
        step, is_last=True, dataset_instructions=dataset_instructions
    )
    user, user_warnings = render_user_prompt(step, task, [])
    warnings += user_warnings
    sent_system = truncate_prompt(system, max_system)
    sent_user = truncate_prompt(user)
    truncated = sent_system != system or sent_user != user
    if truncated:
        warnings.append("Prompt exceeded the length limit and was truncated.")

    agent_trace = ChainStepTrace(
        id=f"{run_id}-S1",
        run_id=run_id,
        index=1,
        node_id=step.node_id,
        name=step.name,
        role=step.role,
        objective=step.objective,
        step_kind="agent",
        selected_route=selected.route_id,
        provider=step.provider,
        model=step.model,
        temperature=step.temperature,
        max_tokens=step.max_tokens,
        output_format="text",
        status="completed",
        include_task=True,
        input_step_indexes=[],
        system_prompt=sent_system,
        user_prompt=sent_user,
        prompt_truncated=truncated,
        warnings=warnings,
        started_at=datetime.now(timezone.utc).isoformat(),
    )
    traces.append(agent_trace)

    t_agent = time.perf_counter()
    try:
        text, ap, ac = complete(
            system=sent_system,
            user=sent_user,
            temperature=step.temperature,
            model=step.model,
            max_tokens=step.max_tokens,
        )
    except Exception as exc:
        agent_trace.latency_sec = round(time.perf_counter() - t_agent, 3)
        agent_trace.status = "error"
        agent_trace.error = _short_error(exc)
        stop_reason = f"Specialist ({step.name}) failed"
        return _assemble_result(
            run_id=run_id,
            config=config,
            task=task,
            router=router,
            routes=routes,
            traces=traces,
            latency=time.perf_counter() - t_run,
            stop_reason=stop_reason,
            parent_run_id=parent_run_id,
        )

    agent_trace.latency_sec = round(time.perf_counter() - t_agent, 3)
    agent_trace.prompt_tokens = ap
    agent_trace.completion_tokens = ac
    agent_trace.cost_usd = round(estimate_cost(ap, ac, step.model), 6)
    total_cost += agent_trace.cost_usd
    agent_trace.response = text

    if not text.strip():
        agent_trace.status = "error"
        agent_trace.error = "The model returned an empty response."
        stop_reason = "Specialist returned an empty response"

    return _assemble_result(
        run_id=run_id,
        config=config,
        task=task,
        router=router,
        routes=routes,
        traces=traces,
        latency=time.perf_counter() - t_run,
        stop_reason=stop_reason,
        parent_run_id=parent_run_id,
    )


def _assemble_result(
    *,
    run_id: str,
    config: AgentConfiguration,
    task: Task,
    router: ResolvedRouter,
    routes: list[ResolvedRoute],
    traces: list[ChainStepTrace],
    latency: float,
    stop_reason: str | None,
    parent_run_id: str | None,
) -> RunResult:
    notes: list[str] = []
    agent_trace = next((t for t in traces if t.index == 1), None)
    router_trace = traces[0] if traces else None
    complete = stop_reason is None and agent_trace and agent_trace.status == "completed"

    answer = ""
    scored = None
    error = None
    if complete and agent_trace:
        answer = agent_trace.response or ""
        scored = score_task_output(task, answer)
        if scored.note:
            notes.append(scored.note)
        if router_trace and router_trace.selected_route:
            notes.append(f"Router selected '{router_trace.selected_route}'.")
            if router_trace.routing_explanation:
                notes.append(router_trace.routing_explanation)
    else:
        failed = next((t for t in traces if t.status == "error"), None)
        if failed:
            error = f"{failed.name} failed: {failed.error}"
        else:
            error = stop_reason or "Routing did not complete."
        notes.append("Incomplete: no scored final answer was produced.")

    models = [router.model]
    for route in routes:
        if route.model not in models:
            models.append(route.model)

    return RunResult(
        id=run_id,
        mode="routing",
        benchmark_id=task.benchmark_id,
        task_id=task.id,
        configuration_id=config.id,
        configuration_name=config.name,
        architecture=config.architecture,
        model=f"{router.model} → {agent_trace.model if agent_trace else '—'}",
        temperature=router.temperature,
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

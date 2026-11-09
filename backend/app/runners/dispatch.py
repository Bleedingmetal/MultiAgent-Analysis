"""Pick the runner for a run mode. Shared by single runs and end-to-end batches."""

from __future__ import annotations

from app import spend_guard
from app.datasets.registry import Task
from app.runners.execute import run_classifier_plan
from app.runners.pipeline import run_pipeline
from app.runners.prompt_chain import ChainConfigError, resolve_chain, run_prompt_chain
from app.runners.routing import RoutingConfigError, resolve_routing, run_routing
from app.schemas import AgentConfiguration, RunResult

# Errors that mean "this configuration cannot run" (client error, nothing spent).
CONFIG_ERRORS = (ChainConfigError, RoutingConfigError)


def _tau_v1():
    from app.benchmarks.tau_retail import run_task

    return run_task


def _tau_v2():
    from app.benchmarks.tau2_retail import run_task

    return run_task


# Benchmarks where the environment drives a conversation (imported lazily: heavy packages)
CONVERSATIONAL = {"tau-retail": _tau_v1, "tau2-retail": _tau_v2}


def preflight(config: AgentConfiguration, mode: str, model_override: str | None = None) -> None:
    """Reject unrunnable chain / routing configs before anything is spent."""
    if mode == "prompt-chain":
        resolve_chain(config, model_override, require_keys=True)
    elif mode == "routing":
        resolve_routing(config, model_override, require_keys=True)


def execute(
    config: AgentConfiguration,
    task: Task,
    *,
    mode: str,
    meter: spend_guard.RunMeter,
    model_override: str | None = None,
    parent_run_id: str | None = None,
) -> RunResult:
    """Run one task. Every dollar spent is added to `meter`, including chain/routing runs."""
    if task.benchmark_id in CONVERSATIONAL:
        # A multi-turn tool-using conversation: the benchmark drives the loop and our
        # configuration answers each turn (see app.benchmarks).
        runner = CONVERSATIONAL[task.benchmark_id]()
        return runner(
            config, task, mode=mode, meter=meter,
            model_override=model_override, parent_run_id=parent_run_id,
        )
    if mode == "prompt-chain":
        result = run_prompt_chain(
            config,
            task,
            model_override=model_override,
            parent_run_id=parent_run_id,
            budget_usd=spend_guard.status()["remaining_budget_usd"],
        )
        meter.add_cost(result.cost_usd)
        return result
    if mode == "routing":
        result = run_routing(
            config, task, model_override=model_override, parent_run_id=parent_run_id
        )
        meter.add_cost(result.cost_usd)
        return result
    # classify-plan, or any configuration through the generic pipeline engine
    runner = run_classifier_plan if mode == "classify-plan" else run_pipeline
    return runner(
        config,
        task,
        meter=meter,
        model_override=model_override,
        parent_run_id=parent_run_id,
    )

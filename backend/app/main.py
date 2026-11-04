from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.datasets import registry
from app.llm import providers_status
from app.runners.execute import run_classifier_plan
from app.runners.pipeline import run_pipeline
from app.runners.prompt_chain import ChainConfigError, resolve_chain, run_prompt_chain
from app.runners.routing import RoutingConfigError, resolve_routing, run_routing
from app.schemas import RunRequest, RunResult
from app import spend_guard, store

app = FastAPI(title="Agent Evaluation API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings()["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    providers = providers_status()
    return {
        "status": "ok",
        "model": settings()["openai_model"],
        "openai_configured": providers["openai"],
        "providers": providers,
        "spend": spend_guard.status(),
        "require_confirm": settings()["require_confirm"],
    }


@app.get("/api/datasets")
async def get_datasets():
    return {"benchmarks": registry.list_benchmarks()}


@app.get("/api/datasets/{benchmark_id}/tasks")
async def get_tasks(benchmark_id: str, limit: int = 20):
    try:
        tasks = registry.list_tasks(benchmark_id, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "benchmark_id": benchmark_id,
        "tasks": [
            {
                "id": t.id,
                "question": t.question,
                "expected_answer": t.expected_answer,
                "expected_display": t.expected_display,
                "scored": t.expected_answer is not None
                and benchmark_id == "finqa",
                # Ground-truth programs/evidence are evaluation-only and must
                # not be exposed to the client before a run.
                "metadata": {
                    key: value
                    for key, value in t.metadata.items()
                    if key
                    not in {
                        "program",
                        "program_re",
                        "steps",
                        "expected_evidence",
                        "table",
                    }
                },
            }
            for t in tasks
        ],
    }


# Sync handler: FastAPI runs it in a worker thread, so multi-call runs
# don't block other requests (health, run history) while they execute.
@app.post("/api/runs", response_model=RunResult)
def create_run(body: RunRequest):
    if settings()["require_confirm"] and not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Confirm required. Re-click Run after the browser confirm dialog.",
        )

    try:
        task = registry.get_task(body.benchmark_id, body.task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if body.mode == "prompt-chain":
        # Reject unrunnable chains before they consume a run slot.
        try:
            resolve_chain(body.configuration, body.model_override, require_keys=True)
        except ChainConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.mode == "routing":
        try:
            resolve_routing(body.configuration, body.model_override, require_keys=True)
        except RoutingConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        spend_guard.begin_run()
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    ok = False
    meter = spend_guard.RunMeter()
    try:
        if body.mode == "prompt-chain":
            result = run_prompt_chain(
                body.configuration,
                task,
                model_override=body.model_override,
                parent_run_id=body.parent_run_id,
                budget_usd=spend_guard.status()["remaining_budget_usd"],
            )
            meter.add_cost(result.cost_usd)
        elif body.mode == "routing":
            result = run_routing(
                body.configuration,
                task,
                model_override=body.model_override,
                parent_run_id=body.parent_run_id,
            )
            meter.add_cost(result.cost_usd)
        else:
            # classify-plan, or any configuration through the generic pipeline engine
            runner = run_classifier_plan if body.mode == "classify-plan" else run_pipeline
            result = runner(
                body.configuration,
                task,
                meter=meter,
                model_override=body.model_override,
                parent_run_id=body.parent_run_id,
            )
        # A chain that fails midway is still a run that spent money on earlier steps.
        ok = result.status == "completed" or result.cost_usd > 0
        return store.add_run(result)
    except (RuntimeError, ChainConfigError, RoutingConfigError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"LLM provider error: {exc}") from exc
    finally:
        spend_guard.end_run(cost_usd=meter.cost_usd, ok=ok)


@app.get("/api/runs")
async def get_runs(limit: int = 50):
    return {"runs": store.list_runs(limit=limit)}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.datasets import registry
from app.llm import providers_status
from app.runners.dispatch import CONFIG_ERRORS, execute, preflight
from app.schemas import BatchRequest, BatchRun, RunRequest, RunResult
from app import batches, spend_guard, store

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
        "model": settings()["default_model"],
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

    # Reject unrunnable chain / routing configs before they consume a run slot.
    try:
        preflight(body.configuration, body.mode, body.model_override)
    except CONFIG_ERRORS as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        spend_guard.begin_run()
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    ok = False
    meter = spend_guard.RunMeter()
    try:
        result = execute(
            body.configuration,
            task,
            mode=body.mode,
            meter=meter,
            model_override=body.model_override,
            parent_run_id=body.parent_run_id,
        )
        # A chain that fails midway is still a run that spent money on earlier steps.
        ok = result.status == "completed" or result.cost_usd > 0
        return store.add_run(result)
    except (RuntimeError, *CONFIG_ERRORS) as exc:
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
    # Questions from end-to-end runs live with their batch, not in run history.
    run = store.get_run(run_id) or batches.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@app.post("/api/batches", response_model=BatchRun)
def create_batch(body: BatchRequest):
    if settings()["require_confirm"] and not body.confirm:
        raise HTTPException(status_code=400, detail="Confirm required.")
    try:
        return batches.start(body)
    except CONFIG_ERRORS as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/batches")
def list_batches(configuration_id: str | None = None, limit: int = 20):
    return {"batches": batches.list_batches(configuration_id, limit=limit)}


@app.get("/api/batches/{batch_id}", response_model=BatchRun)
def get_batch(batch_id: str):
    batch = batches.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="End-to-end run not found")
    return batch


@app.post("/api/batches/{batch_id}/cancel", response_model=BatchRun)
def cancel_batch(batch_id: str):
    batch = batches.cancel(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="End-to-end run not found")
    return batch

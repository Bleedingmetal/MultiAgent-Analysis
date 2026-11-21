from __future__ import annotations

import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import settings
from app.datasets import registry
from app.llm import providers_status
from app.runners.dispatch import CONFIG_ERRORS, execute, preflight
from app.schemas import BatchRequest, BatchRun, RunRequest, RunResult
from app import batches, metrics, overview, spend_guard, store

app = FastAPI(title="Agent Evaluation API", version="0.1.0")

# Benchmark data is not committed; a fresh clone fetches it on first start.
_datasets = {"downloading": False, "error": None, "checked": False}


def _bootstrap_datasets() -> None:
    _datasets["downloading"] = True
    try:
        from scripts.download_datasets import ensure_datasets

        for line in ensure_datasets():
            print(f"[datasets] {line}", flush=True)
        registry.reload()
    except Exception as exc:  # noqa: BLE001
        _datasets["error"] = f"{type(exc).__name__}: {exc}"
        print(f"[datasets] could not download: {exc}", flush=True)
    finally:
        _datasets["downloading"] = False
        _datasets["checked"] = True


@app.on_event("startup")
def _on_startup() -> None:
    threading.Thread(target=_bootstrap_datasets, name="datasets", daemon=True).start()

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
        "datasets": {
            **_datasets,
            "available": {b["id"]: b["available"] for b in registry.list_benchmarks(include_missing=True)},
        },
    }


@app.get("/api/datasets")
async def get_datasets():
    return {"benchmarks": registry.list_benchmarks()}


@app.get("/api/overview")
def get_overview():
    """Where each task stands, what changed, and what needs attention (see app.overview)."""
    counts = {b["id"]: b["task_count"] for b in registry.list_benchmarks(include_missing=True)}
    return overview.build(batches.all_batches(), counts)


class HideBody(BaseModel):
    configuration_id: str
    hidden: bool = True


@app.post("/api/overview/hidden")
def set_overview_hidden(body: HideBody):
    """Keep a configuration (a test or scratch setup) off the Overview, or bring it back."""
    return {"hidden_configuration_ids": sorted(overview.set_hidden(body.configuration_id, body.hidden))}


@app.get("/api/metrics/repeatability")
async def get_repeatability(benchmark: str | None = None, k: int = metrics.DEFAULT_K):
    """Reliability (pass^k) and consistency per configuration, over every stored execution."""
    if k < 1 or k > 20:
        raise HTTPException(status_code=400, detail="k must be between 1 and 20")
    runs = metrics.load_runs(batches.BATCHES_DIR, store.RUNS_FILE)
    return {"k": k, "groups": metrics.repeatability(runs, benchmark_id=benchmark, k=k)}


@app.get("/api/datasets/{benchmark_id}/tasks")
async def get_tasks(benchmark_id: str, limit: int = 20, q: str | None = None):
    try:
        # With q, search the whole benchmark; without it, the first `limit` tasks.
        tasks = (
            registry.search_tasks(benchmark_id, q, limit=limit)
            if q and q.strip()
            else registry.list_tasks(benchmark_id, limit=limit)
        )
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
                "scored": benchmark_id in registry.SCORED_BENCHMARKS
                and (t.expected_answer is not None or benchmark_id != "finqa"),
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


class ContinueBody(BaseModel):
    budget_usd: float | None = None


@app.post("/api/batches/{batch_id}/continue", response_model=BatchRun)
def continue_batch(batch_id: str, body: ContinueBody | None = None):
    try:
        batch = batches.resume(batch_id, body.budget_usd if body else None)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not batch:
        raise HTTPException(status_code=404, detail="End-to-end run not found")
    return batch


@app.post("/api/batches/{batch_id}/cancel", response_model=BatchRun)
def cancel_batch(batch_id: str):
    batch = batches.cancel(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="End-to-end run not found")
    return batch

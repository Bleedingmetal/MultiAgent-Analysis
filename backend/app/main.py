from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.datasets import registry
from app.runners.execute import run_classifier_plan, run_single_agent
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
    key = settings()["openai_api_key"]
    return {
        "status": "ok",
        "model": settings()["openai_model"],
        "openai_configured": bool(key) and not key.startswith("sk-your-key"),
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
                "metadata": t.metadata,
            }
            for t in tasks
        ],
    }


@app.post("/api/runs", response_model=RunResult)
async def create_run(body: RunRequest):
    if settings()["require_confirm"] and not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Confirm required. Re-click Run after the browser confirm dialog.",
        )

    try:
        task = registry.get_task(body.benchmark_id, body.task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        spend_guard.begin_run()
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    ok = False
    cost = 0.0
    try:
        if body.mode == "classify-plan":
            result = run_classifier_plan(
                body.configuration,
                task,
                model_override=body.model_override,
                parent_run_id=body.parent_run_id,
            )
        else:
            result = run_single_agent(
                body.configuration,
                task,
                model_override=body.model_override,
                parent_run_id=body.parent_run_id,
            )
        cost = result.cost_usd
        ok = True
        return store.add_run(result)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"OpenAI error: {exc}") from exc
    finally:
        spend_guard.end_run(cost_usd=cost, ok=ok)


@app.get("/api/runs")
async def get_runs(limit: int = 50):
    return {"runs": store.list_runs(limit=limit)}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run

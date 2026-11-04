"""End-to-end runs: one configuration over a deterministic sample of a dataset.

A batch runs questions concurrently through the same runners as a single run
(`app.runners.dispatch`), so its numbers are directly comparable with single runs.
Progress is saved after every question, so the UI can poll while it runs and a
restart leaves a readable (interrupted) batch behind.

Files, per batch, in BATCHES_DIR (default backend/data/batches):
  <id>.json         batch metadata, summary, and one light row per question
  <id>.runs.jsonl   full RunResult (traces, prompts) for every finished question
"""

from __future__ import annotations

import os
import statistics
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from app import spend_guard
from app.datasets import registry
from app.datasets.registry import Task
from app.runners.dispatch import execute, preflight
from app.schemas import (
    BatchItem,
    BatchRequest,
    BatchRun,
    BatchSummary,
    RunResult,
)

BATCHES_DIR = (
    Path(os.environ["BATCHES_DIR"]).expanduser()
    if os.environ.get("BATCHES_DIR")
    else Path(__file__).resolve().parents[1] / "data" / "batches"
)

_lock = threading.Lock()
_batches: dict[str, BatchRun] = {}
# run_id -> batch_id, for opening a single question's full run
_run_index: dict[str, str] = {}
_cancel: dict[str, threading.Event] = {}
_loaded = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _meta_path(batch_id: str) -> Path:
    return BATCHES_DIR / f"{batch_id}.json"


def _runs_path(batch_id: str) -> Path:
    return BATCHES_DIR / f"{batch_id}.runs.jsonl"


def _save(batch: BatchRun) -> None:
    BATCHES_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _meta_path(batch.id).with_suffix(".json.tmp")
    tmp.write_text(batch.model_dump_json(), encoding="utf-8")
    tmp.replace(_meta_path(batch.id))


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        if BATCHES_DIR.exists():
            for path in BATCHES_DIR.glob("*.json"):
                try:
                    batch = BatchRun.model_validate_json(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if batch.status == "running":
                    # The server stopped while this batch was running.
                    _finish(batch, "interrupted", "The server restarted during this run.")
                    _save(batch)
                _batches[batch.id] = batch
                for item in batch.items:
                    if item.run_id:
                        _run_index[item.run_id] = batch.id
        _loaded = True


def _percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def summarize(batch: BatchRun, *, elapsed_sec: float, tokens: tuple[int, int]) -> BatchSummary:
    items = batch.items
    finished = [i for i in items if i.status in {"passed", "failed", "unscored", "error"}]
    passed = sum(1 for i in items if i.status == "passed")
    failed = sum(1 for i in items if i.status == "failed")
    scored = passed + failed
    cost = sum(i.cost_usd for i in items)
    latencies = [i.latency_sec for i in finished if i.status != "error"]
    programs = [i.program_match for i in finished if i.program_match is not None]
    return BatchSummary(
        total=len(items),
        done=len(finished),
        passed=passed,
        failed=failed,
        errors=sum(1 for i in items if i.status == "error"),
        skipped=sum(1 for i in items if i.status == "skipped"),
        pass_rate=passed / scored if scored else None,
        cost_usd=round(cost, 6),
        avg_cost_usd=round(cost / len(finished), 6) if finished else None,
        cost_per_pass_usd=round(cost / passed, 6) if passed else None,
        projected_cost_usd=(
            round(cost / len(finished) * len(items), 4)
            if finished and batch.status == "running"
            else None
        ),
        avg_latency_sec=round(statistics.fmean(latencies), 3) if latencies else None,
        p50_latency_sec=round(_percentile(latencies, 0.5), 3) if latencies else None,
        p95_latency_sec=round(_percentile(latencies, 0.95), 3) if latencies else None,
        prompt_tokens=tokens[0],
        completion_tokens=tokens[1],
        program_match_rate=(sum(programs) / len(programs)) if programs else None,
        disputed=sum(1 for i in finished if i.label_disputed),
        elapsed_sec=round(elapsed_sec, 1),
    )


def _finish(batch: BatchRun, status: str, reason: str | None) -> None:
    for item in batch.items:
        if item.status in {"pending", "running"}:
            item.status = "skipped"
    batch.status = status  # type: ignore[assignment]
    batch.stop_reason = reason
    batch.finished_at = _now()
    batch.summary.skipped = sum(1 for i in batch.items if i.status == "skipped")
    batch.summary.projected_cost_usd = None


def _apply_result(item: BatchItem, result: RunResult) -> None:
    item.run_id = result.id
    item.scored_answer = result.scored_answer
    item.success = result.success
    item.cost_usd = result.cost_usd
    item.latency_sec = result.latency_sec
    comparison = result.reasoning_comparison
    item.program_match = comparison.execution_matches_expected if comparison else None
    item.label_disputed = result.label_disputed
    if result.status != "completed":
        item.status = "error"
        item.error = result.error or "The run did not complete."
    elif result.success is True:
        item.status = "passed"
    elif result.success is False:
        item.status = "failed"
    else:
        item.status = "unscored"


def start(req: BatchRequest) -> BatchRun:
    """Validate, then run in a background thread. Raises RuntimeError / config errors."""
    _ensure_loaded()
    if req.benchmark_id not in registry.SCORED_BENCHMARKS:
        raise RuntimeError(f"End-to-end runs need a scored dataset; {req.benchmark_id} is not.")
    with _lock:
        running = next((b for b in _batches.values() if b.status == "running"), None)
    if running:
        raise RuntimeError(
            f"End-to-end run {running.id} ({running.configuration_name}) is still running. "
            "Wait for it or cancel it first."
        )
    preflight(req.configuration, req.mode)
    tasks = registry.sample_tasks(req.benchmark_id, req.size)
    spend_guard.begin_batch()

    models = [
        n.modelSettings.model
        for n in req.configuration.nodes
        if n.type == "model" and n.modelSettings and n.modelSettings.model
    ]
    batch = BatchRun(
        id=f"E2E-{uuid.uuid4().hex[:8].upper()}",
        configuration_id=req.configuration.id,
        configuration_name=req.configuration.name,
        architecture=req.configuration.architecture,
        mode=req.mode,
        benchmark_id=req.benchmark_id,
        size=len(tasks),
        budget_usd=req.budget_usd,
        concurrency=req.concurrency,
        created_at=_now(),
        models=list(dict.fromkeys(models)),
        configuration=req.configuration,
        items=[
            BatchItem(
                index=i,
                task_id=t.id,
                question=t.question,
                expected_display=t.expected_display or t.expected_answer,
            )
            for i, t in enumerate(tasks)
        ],
    )
    batch.summary = summarize(batch, elapsed_sec=0, tokens=(0, 0))
    cancel = threading.Event()
    with _lock:
        _batches[batch.id] = batch
        _cancel[batch.id] = cancel
        _save(batch)
    threading.Thread(
        target=_run, args=(batch, tasks, req, cancel), name=batch.id, daemon=True
    ).start()
    return batch


def _run(batch: BatchRun, tasks: list[Task], req: BatchRequest, cancel: threading.Event) -> None:
    t0 = time.perf_counter()
    queue = iter(range(len(tasks)))
    tokens = [0, 0]
    stop_reason: list[str] = []

    def next_index() -> int | None:
        with _lock:
            if cancel.is_set() or stop_reason:
                return None
            spent = sum(i.cost_usd for i in batch.items)
            if spent >= req.budget_usd:
                stop_reason.append(f"Reached the ${req.budget_usd:.2f} spend cap for this run.")
                return None
            if spend_guard.remaining_budget_usd() <= 0:
                stop_reason.append("Reached today's spend cap (DAILY_BUDGET_USD).")
                return None
            index = next(queue, None)
            if index is not None:
                batch.items[index].status = "running"
            return index

    def worker() -> None:
        while (index := next_index()) is not None:
            item = batch.items[index]
            meter = spend_guard.RunMeter()
            result: RunResult | None = None
            error: str | None = None
            try:
                result = execute(
                    req.configuration,
                    tasks[index],
                    mode=req.mode,
                    meter=meter,
                    parent_run_id=batch.id,  # question runs link back to their batch
                )
            except Exception as exc:  # one bad question must not stop the batch
                error = f"{type(exc).__name__}: {exc}"[:400]
            spend_guard.record_spend(meter.cost_usd)
            with _lock:
                if result is not None:
                    _apply_result(item, result)
                    tokens[0] += result.prompt_tokens
                    tokens[1] += result.completion_tokens
                    with _runs_path(batch.id).open("a", encoding="utf-8") as f:
                        f.write(result.model_dump_json() + "\n")
                    _run_index[result.id] = batch.id
                else:
                    item.status = "error"
                    item.error = error
                    item.cost_usd = round(meter.cost_usd, 6)
                batch.summary = summarize(
                    batch, elapsed_sec=time.perf_counter() - t0, tokens=(tokens[0], tokens[1])
                )
                _save(batch)

    try:
        with ThreadPoolExecutor(max_workers=req.concurrency) as pool:
            for _ in range(req.concurrency):
                pool.submit(worker)
        status = "cancelled" if cancel.is_set() else ("stopped" if stop_reason else "completed")
        reason = "Cancelled from the UI." if cancel.is_set() else (stop_reason[0] if stop_reason else None)
    except Exception as exc:  # noqa: BLE001
        status, reason = "failed", f"{type(exc).__name__}: {exc}"
    with _lock:
        batch.summary = summarize(
            batch, elapsed_sec=time.perf_counter() - t0, tokens=(tokens[0], tokens[1])
        )
        _finish(batch, status, reason)
        _save(batch)
        _cancel.pop(batch.id, None)


def cancel(batch_id: str) -> BatchRun | None:
    _ensure_loaded()
    with _lock:
        event = _cancel.get(batch_id)
        batch = _batches.get(batch_id)
    if event:
        event.set()
    return batch


def get(batch_id: str) -> BatchRun | None:
    _ensure_loaded()
    with _lock:
        batch = _batches.get(batch_id)
        return batch.model_copy(deep=True) if batch else None


def list_batches(configuration_id: str | None = None, limit: int = 20) -> list[BatchRun]:
    """Newest first, without per-question rows (use get() for those)."""
    _ensure_loaded()
    with _lock:
        rows = [
            b.model_copy(update={"items": [], "configuration": None})
            for b in _batches.values()
            if configuration_id is None or b.configuration_id == configuration_id
        ]
    rows.sort(key=lambda b: b.created_at, reverse=True)
    return rows[:limit]


def get_run(run_id: str) -> RunResult | None:
    """Full run for one question of a batch."""
    _ensure_loaded()
    with _lock:
        batch_id = _run_index.get(run_id)
    if not batch_id or not _runs_path(batch_id).exists():
        return None
    with _runs_path(batch_id).open(encoding="utf-8") as f:
        for line in f:
            if f'"id":"{run_id}"' in line:
                run = RunResult.model_validate_json(line)
                if run.id == run_id:
                    return run
    return None

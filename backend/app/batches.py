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
    BatchAttempt,
    BatchItem,
    BatchRequest,
    BatchRun,
    BatchSummary,
    PassSummary,
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
                    for attempt in item.attempts:
                        if attempt.run_id:
                            _run_index[attempt.run_id] = batch.id
                    if item.run_id:
                        _run_index[item.run_id] = batch.id
        _loaded = True


def _percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


FINISHED_ITEM = {"passed", "failed", "mixed", "unscored", "error"}


def summarize(batch: BatchRun, *, elapsed_sec: float, tokens: tuple[int, int]) -> BatchSummary:
    items = batch.items
    k = batch.passes
    finished = [i for i in items if i.status in FINISHED_ITEM]
    attempts = [a for i in items for a in i.attempts]
    passed = sum(1 for a in attempts if a.status == "passed")
    failed = sum(1 for a in attempts if a.status == "failed")
    scored = passed + failed
    cost = sum(i.cost_usd for i in items)
    latencies = [a.latency_sec for a in attempts if a.status != "error"]
    programs = [a.program_match for a in attempts if a.program_match is not None]
    # pass^k / pass@k over questions that got every pass and were scored at least once
    complete = [i for i in finished if len(i.attempts) == k and i.passes_passed + i.passes_failed > 0]
    all_right = sum(1 for i in complete if i.passes_failed == 0)
    any_right = sum(1 for i in complete if i.passes_passed > 0)
    per_pass: list[PassSummary] = []
    for p in range(k):
        rows = [a for a in attempts if a.pass_index == p]
        p_passed = sum(1 for a in rows if a.status == "passed")
        p_failed = sum(1 for a in rows if a.status == "failed")
        p_timed = [a.latency_sec for a in rows if a.status != "error"]
        per_pass.append(
            PassSummary(
                pass_index=p,
                done=len(rows),
                passed=p_passed,
                failed=p_failed,
                errors=sum(1 for a in rows if a.status == "error"),
                pass_rate=p_passed / (p_passed + p_failed) if p_passed + p_failed else None,
                cost_usd=round(sum(a.cost_usd for a in rows), 6),
                avg_latency_sec=round(statistics.fmean(p_timed), 3) if p_timed else None,
            )
        )
    rates = [p.pass_rate for p in per_pass if p.pass_rate is not None and p.done == len(items)]
    return BatchSummary(
        total=len(items),
        done=len(finished),
        errors=sum(1 for i in items if i.status == "error"),
        skipped=sum(1 for i in items if i.status == "skipped"),
        passes=k,
        attempts_total=len(items) * k,
        attempts_done=len(attempts),
        passed=passed,
        failed=failed,
        pass_rate=passed / scored if scored else None,
        pass_all_rate=all_right / len(complete) if complete else None,
        pass_any_rate=any_right / len(complete) if complete else None,
        mixed=sum(1 for i in items if i.status == "mixed"),
        per_pass=per_pass,
        pass_rate_min=min(rates) if rates else None,
        pass_rate_max=max(rates) if rates else None,
        cost_usd=round(cost, 6),
        avg_cost_usd=round(cost / len(attempts), 6) if attempts else None,
        cost_per_pass_usd=round(cost / passed, 6) if passed else None,
        projected_cost_usd=(
            round(cost / len(attempts) * len(items) * k, 4)
            if attempts and batch.status == "running"
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
            # A question that got some of its passes keeps them; one that got none is skipped
            item.status = _aggregate_status(item) if item.attempts else "skipped"
    batch.status = status  # type: ignore[assignment]
    batch.stop_reason = reason
    batch.finished_at = _now()
    batch.summary.skipped = sum(1 for i in batch.items if i.status == "skipped")
    batch.summary.projected_cost_usd = None


def _attempt_from_result(pass_index: int, result: RunResult) -> BatchAttempt:
    comparison = result.reasoning_comparison
    if result.status != "completed":
        status, error = "error", result.error or "The run did not complete."
    elif result.success is True:
        status, error = "passed", None
    elif result.success is False:
        status, error = "failed", None
    else:
        status, error = "unscored", None
    return BatchAttempt(
        pass_index=pass_index,
        status=status,  # type: ignore[arg-type]
        run_id=result.id,
        scored_answer=result.scored_answer,
        success=result.success,
        program_match=comparison.execution_matches_expected if comparison else None,
        cost_usd=result.cost_usd,
        latency_sec=result.latency_sec,
        error=error,
    )


def _aggregate_status(item: BatchItem) -> str:
    """The question's status from its finished passes."""
    statuses = {a.status for a in item.attempts}
    if not statuses:
        return "pending"
    if statuses == {"error"}:
        return "error"
    scored = statuses & {"passed", "failed"}
    if scored == {"passed", "failed"}:
        return "mixed"
    if scored == {"passed"}:
        return "passed"
    if scored == {"failed"}:
        return "failed"
    return "unscored"


def _record_attempt(item: BatchItem, attempt: BatchAttempt, *, passes: int, label_disputed: bool = False) -> None:
    item.attempts.append(attempt)
    item.attempts.sort(key=lambda a: a.pass_index)
    first = item.attempts[0]
    item.run_id = first.run_id
    item.scored_answer = first.scored_answer
    item.success = first.success
    item.program_match = first.program_match
    item.label_disputed = item.label_disputed or label_disputed
    item.cost_usd = round(sum(a.cost_usd for a in item.attempts), 6)
    timed = [a.latency_sec for a in item.attempts if a.status != "error"]
    item.latency_sec = round(sum(timed) / len(timed), 3) if timed else 0.0
    item.passes_passed = sum(1 for a in item.attempts if a.status == "passed")
    item.passes_failed = sum(1 for a in item.attempts if a.status == "failed")
    item.error = next((a.error for a in item.attempts if a.error), None)
    item.status = _aggregate_status(item) if len(item.attempts) >= passes else "running"  # type: ignore[assignment]


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
        passes=req.passes,
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
    # Pass-major: the whole question set runs once, then runs again. A stopped run
    # leaves complete passes behind, which is what makes passes comparable.
    queue = iter((q, p) for p in range(req.passes) for q in range(len(tasks)))
    tokens = [0, 0]
    stop_reason: list[str] = []

    def next_index() -> tuple[int, int] | None:
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
            job = next(queue, None)
            if job is not None:
                batch.items[job[0]].status = "running"
            return job

    def worker() -> None:
        while (job := next_index()) is not None:
            index, pass_index = job
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
                    _record_attempt(
                        item,
                        _attempt_from_result(pass_index, result),
                        passes=req.passes,
                        label_disputed=result.label_disputed,
                    )
                    tokens[0] += result.prompt_tokens
                    tokens[1] += result.completion_tokens
                    with _runs_path(batch.id).open("a", encoding="utf-8") as f:
                        f.write(result.model_dump_json() + "\n")
                    _run_index[result.id] = batch.id
                else:
                    _record_attempt(
                        item,
                        BatchAttempt(
                            pass_index=pass_index,
                            status="error",
                            cost_usd=round(meter.cost_usd, 6),
                            error=error,
                        ),
                        passes=req.passes,
                    )
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

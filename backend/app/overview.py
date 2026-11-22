"""The Overview: where each task stands, what changed, and what needs attention.

A quick look, not a leaderboard. Rules (docs: .impeccable/briefs/overview-and-lab.md):
- a task's result is judged from complete runs only: finished, every question graded, at least
  MIN_N questions; each configuration counts once, by its latest complete run;
- single vs multi-agent is compared only on the questions both ran, paired question by
  question, so a 10-question run and a 50-question run are compared on their shared 10;
- configurations the user hid stay out of the Overview (they remain under Runs and Compare);
- "top-up" runs (extra questions run to settle a too-close comparison) are never a
  configuration's run of their own: their answers are pooled into that configuration's
  side of the single vs multi-agent comparison, and nowhere else.
"""

from __future__ import annotations

import json
import math
import statistics
import threading
import time
from pathlib import Path
from typing import Any, Iterable

from app import batches as _batches
from app.batches import BATCHES_DIR
from app.datasets import registry
from app.schemas import BatchItem, BatchRequest, BatchRun

MIN_N = 10
# Fewer shared questions than this and the comparison is not shown at all
MIN_SHARED = 10
RECENT = 6
FINISHED = {"completed", "stopped", "cancelled", "interrupted", "failed"}
HIDDEN_FILE = BATCHES_DIR.parent / "overview_hidden.json"
_lock = threading.Lock()


# ---- hidden configurations ------------------------------------------------------------


def hidden() -> set[str]:
    try:
        return set(json.loads(HIDDEN_FILE.read_text(encoding="utf-8")).get("configuration_ids", []))
    except (OSError, ValueError):
        return set()


def set_hidden(configuration_id: str, hide: bool) -> set[str]:
    with _lock:
        ids = hidden()
        (ids.add if hide else ids.discard)(configuration_id)
        HIDDEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        HIDDEN_FILE.write_text(json.dumps({"configuration_ids": sorted(ids)}, indent=2), encoding="utf-8")
        return ids


# ---- per-run figures ------------------------------------------------------------------


def accuracy(b: BatchRun) -> float | None:
    """Partial credit for rubric benchmarks (FAB), pass rate otherwise."""
    return b.summary.mean_score if b.summary.mean_score is not None else b.summary.pass_rate


def is_topup(b: BatchRun) -> bool:
    return b.purpose == "top-up"


def complete(b: BatchRun) -> bool:
    """A run that can stand for its configuration. Top-ups never do (they are supplements)."""
    s = b.summary
    return (
        not is_topup(b)
        and b.status == "completed"
        and b.size >= MIN_N
        and s.passed + s.failed == b.size * max(1, b.passes)
    )


# task_id -> (score 0-1, cost per answer, item, id of the batch the item is in)
Scores = dict[str, tuple[float, float, BatchItem, str]]


def _question_scores(b: BatchRun) -> Scores:
    """task_id -> (score 0-1 averaged over passes, cost per answer, item, batch id) for graded questions."""
    out: Scores = {}
    for item in b.items:
        graded = [a for a in item.attempts if a.status in ("passed", "failed")]
        if not graded:
            continue
        scores = [a.score if a.score is not None else (1.0 if a.status == "passed" else 0.0) for a in graded]
        out[item.task_id] = (statistics.fmean(scores), statistics.fmean(a.cost_usd for a in graded), item, b.id)
    return out


def _pooled_scores(main: BatchRun, topups: Iterable[BatchRun] = ()) -> Scores:
    """The main run's question scores plus its top-ups'. A question answered in several
    runs takes the mean of its takes; its item (for links) comes from the main run if there."""
    takes: dict[str, list[tuple[float, float, BatchItem, str]]] = {}
    for b in [main, *topups]:
        for t, row in _question_scores(b).items():
            takes.setdefault(t, []).append(row)
    return {
        t: (statistics.fmean(r[0] for r in rows), statistics.fmean(r[1] for r in rows), rows[0][2], rows[0][3])
        for t, rows in takes.items()
    }


def _topups_for(runs: list[BatchRun], main: BatchRun) -> list[BatchRun]:
    """Completed top-up runs of the same configuration on the same task."""
    return [
        b for b in runs
        if is_topup(b) and b.status == "completed"
        and b.configuration_id == main.configuration_id and b.benchmark_id == main.benchmark_id
    ]


def _figures(b: BatchRun) -> dict[str, Any]:
    s = b.summary
    return {
        "batch_id": b.id,
        "configuration_id": b.configuration_id,
        "configuration_name": b.configuration_name,
        "architecture": b.architecture,
        "models": b.models,
        "accuracy": accuracy(b),
        "cost_per_correct_usd": s.cost_per_pass_usd,
        "time_per_question_sec": s.avg_latency_sec,
        "questions": b.size,
        "passes": max(1, b.passes),
        "created_at": b.created_at,
    }


# ---- single vs multi-agent on shared questions -------------------------------------------


def compare(
    single: BatchRun,
    multi: BatchRun,
    single_topups: Iterable[BatchRun] = (),
    multi_topups: Iterable[BatchRun] = (),
) -> dict[str, Any]:
    """Paired comparison on the questions both sides graded (main run plus top-ups)."""
    s_scores, m_scores = _pooled_scores(single, single_topups), _pooled_scores(multi, multi_topups)
    shared = [t for t in s_scores if t in m_scores]
    if len(shared) < MIN_SHARED:
        return {"shared": len(shared), "comparable": False}
    s_acc = statistics.fmean(s_scores[t][0] for t in shared)
    m_acc = statistics.fmean(m_scores[t][0] for t in shared)
    diffs = [m_scores[t][0] - s_scores[t][0] for t in shared]
    mean = statistics.fmean(diffs)
    sd = statistics.stdev(diffs) if len(diffs) > 1 else 0.0
    se = sd / math.sqrt(len(diffs))
    if mean == 0:
        verdict = "even"
    elif se == 0 or abs(mean) > 1.96 * se:
        verdict = "settled"
    else:
        verdict = "too-close"
    # Questions per side a paired comparison would need to settle a difference this size
    more = None
    if verdict == "too-close" and mean != 0:
        needed = math.ceil((1.96 * sd / abs(mean)) ** 2)
        more = max(0, needed - len(shared))
    s_cost = sum(s_scores[t][1] for t in shared)
    m_cost = sum(m_scores[t][1] for t in shared)
    s_right = sum(s_scores[t][0] for t in shared)
    m_right = sum(m_scores[t][0] for t in shared)

    def changed(sign: int) -> list[dict[str, Any]]:
        rows = []
        for t in shared:
            d = m_scores[t][0] - s_scores[t][0]
            if d * sign > 0:
                item = s_scores[t][2]
                rows.append({
                    "task_id": t,
                    "question": item.question,
                    "single": round(s_scores[t][0], 4),
                    "multi": round(m_scores[t][0], 4),
                    "single_item": item.index,
                    "multi_item": m_scores[t][2].index,
                    # the run each item is in (a top-up, for questions added to settle it)
                    "single_batch_id": s_scores[t][3],
                    "multi_batch_id": m_scores[t][3],
                })
        return rows

    return {
        "comparable": True,
        "shared": len(shared),
        "single_accuracy": s_acc,
        "multi_accuracy": m_acc,
        "difference": m_acc - s_acc,
        "verdict": verdict,
        "more_questions": more,
        # cost per correct answer on the shared questions, and per question
        "single_cost_per_correct_usd": s_cost / s_right if s_right else None,
        "multi_cost_per_correct_usd": m_cost / m_right if m_right else None,
        "cost_to_settle_usd": (
            round(more * (s_cost + m_cost) / len(shared), 4) if more else None
        ),
        "multi_lost": changed(-1),
        "multi_won": changed(1),
    }


# ---- the page -------------------------------------------------------------------------


def _latest_complete_per_config(runs: list[BatchRun]) -> list[BatchRun]:
    seen: dict[str, BatchRun] = {}
    for b in runs:  # newest first
        if complete(b) and b.configuration_id not in seen:
            seen[b.configuration_id] = b
    return list(seen.values())


def _best(runs: list[BatchRun]) -> BatchRun | None:
    scored = [b for b in runs if accuracy(b) is not None]
    if not scored:
        return None
    # most accurate first, then cheapest per correct answer
    return min(scored, key=lambda b: (-(accuracy(b) or 0), b.summary.cost_per_pass_usd or math.inf))


def _not_finished_reason(b: BatchRun) -> str | None:
    s = b.summary
    if b.status == "running":
        return "still running" + (", a top-up for the comparison" if is_topup(b) else "")
    if b.status == "paused":
        return "paused at the budget check"
    if is_topup(b) and b.status == "completed":
        return "top-up for the comparison"
    if s.errors:
        return f"{s.errors} of {b.size} didn't run"
    if b.status != "completed" or s.passed + s.failed < b.size * max(1, b.passes):
        return "stopped early" + (f": {b.stop_reason}" if b.stop_reason else "")
    if b.size < MIN_N:
        # a quick test run: shown, but too small to count
        return f"only {b.size} {'question' if b.size == 1 else 'questions'}, a test run"
    return None


def _visible(batches: list[BatchRun]) -> tuple[set[str], list[BatchRun]]:
    hide = hidden()
    return hide, [b for b in batches if b.configuration_id not in hide]  # newest first


def _sides(bench_runs: list[BatchRun]) -> tuple[list[BatchRun], BatchRun | None, BatchRun | None]:
    latest = _latest_complete_per_config(bench_runs)
    single = _best([b for b in latest if b.architecture == "single-agent"])
    multi = _best([b for b in latest if b.architecture != "single-agent"])
    return latest, single, multi


def _compare_sides(bench_runs: list[BatchRun], single: BatchRun, multi: BatchRun) -> dict[str, Any]:
    return compare(single, multi, _topups_for(bench_runs, single), _topups_for(bench_runs, multi))


def build(batches: list[BatchRun], task_counts: dict[str, int] | None = None) -> dict[str, Any]:
    hide, runs = _visible(batches)

    tasks = []
    for bench in dict.fromkeys(b.benchmark_id for b in runs):
        bench_runs = [b for b in runs if b.benchmark_id == bench]
        latest, single, multi = _sides(bench_runs)
        best = _best(latest)
        tasks.append({
            "benchmark_id": bench,
            "task_count": (task_counts or {}).get(bench),
            "complete_runs": len(latest),
            "best": _figures(best) if best else None,
            "single": _figures(single) if single else None,
            "multi": _figures(multi) if multi else None,
            "comparison": _compare_sides(bench_runs, single, multi) if single and multi else None,
            "approximate": bench == "fab",
        })

    recent = []
    for b in runs[:RECENT]:
        prev = next(
            (p for p in runs if p.configuration_id == b.configuration_id and p.benchmark_id == b.benchmark_id
             and p.created_at < b.created_at and complete(p)),
            None,
        ) if complete(b) else None  # a change means something only between two complete runs
        acc = accuracy(b)
        recent.append({
            "batch_id": b.id,
            "configuration_name": b.configuration_name,
            "architecture": b.architecture,
            "benchmark_id": b.benchmark_id,
            "status": b.status,
            "done": b.summary.done,
            "total": b.summary.total,
            "accuracy": acc,
            "change": (acc - accuracy(prev)) if acc is not None and prev is not None else None,
            "created_at": b.created_at,
            "not_finished": _not_finished_reason(b),
        })

    attention: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for b in runs:  # each configuration's latest run per task, if it didn't finish cleanly
        if is_topup(b):
            continue  # a supplement, not the configuration's own run
        key = (b.configuration_id, b.benchmark_id)
        if key in seen:
            continue
        seen.add(key)
        why = _not_finished_reason(b)
        finished_test = b.status == "completed" and b.size < MIN_N  # nothing to act on
        if why and b.status not in ("running",) and not finished_test:
            attention.append({
                "kind": "unfinished",
                "batch_id": b.id,
                "configuration_name": b.configuration_name,
                "benchmark_id": b.benchmark_id,
                "reason": why,
            })
    for t in tasks:
        c = t["comparison"]
        if c and c.get("comparable") and c["verdict"] == "too-close":
            attention.append({
                "kind": "too-close",
                "benchmark_id": t["benchmark_id"],
                "single_batch_id": t["single"]["batch_id"],
                "multi_batch_id": t["multi"]["batch_id"],
                "more_questions": c["more_questions"],
                "cost_usd": c["cost_to_settle_usd"],
            })
        elif c and not c.get("comparable") and t["single"] and t["multi"]:
            attention.append({
                "kind": "not-comparable",
                "benchmark_id": t["benchmark_id"],
                "shared": c["shared"],
                "single_batch_id": t["single"]["batch_id"],
                "multi_batch_id": t["multi"]["batch_id"],
            })

    return {
        "tasks": tasks,
        "recent": recent,
        "attention": attention[:6],
        "hidden_configuration_ids": sorted(hide),
        "running": sum(1 for b in runs if b.status in ("running", "paused")),
        # top-up runs to settle a comparison are still to start or going
        "settling": _settling["active"],
    }


# ---- settling a too-close comparison ----------------------------------------------------


class SettleError(Exception):
    """Plain-words reason the comparison can't be settled now; `status` is the HTTP code."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _cost_per_answer(b: BatchRun) -> float:
    s = b.summary
    if s.avg_cost_usd is not None:
        return s.avg_cost_usd
    answers = s.attempts_done or (s.passed + s.failed + s.errors)
    return s.cost_usd / answers if answers else 0.0


def settle_plan(batches: list[BatchRun], benchmark_id: str) -> dict[str, Any]:
    """What it takes to settle a too-close comparison: the first `shared + more` questions
    of the fixed sample, minus what each side already answered. Raises SettleError.

    Each side also carries `batch_id` (its main run) and `task_ids` (the questions to run);
    `public_plan` drops the ids for the API.
    """
    _, runs = _visible(batches)
    bench_runs = [b for b in runs if b.benchmark_id == benchmark_id]
    _, single, multi = _sides(bench_runs)
    if not single or not multi:
        raise SettleError("This task doesn't have a complete single-agent and multi-agent run to compare.")
    single_topups, multi_topups = _topups_for(bench_runs, single), _topups_for(bench_runs, multi)
    c = compare(single, multi, single_topups, multi_topups)
    if not c.get("comparable") or c.get("verdict") != "too-close" or not c.get("more_questions"):
        raise SettleError("This comparison doesn't need more questions.")
    # sample_tasks caps at the dataset size
    target = [t.id for t in registry.sample_tasks(benchmark_id, c["shared"] + c["more_questions"])]
    sides = []
    total = 0.0
    for side, main, topups in (("single", single, single_topups), ("multi", multi, multi_topups)):
        have = _pooled_scores(main, topups)
        missing = [t for t in target if t not in have]
        cost = round(len(missing) * _cost_per_answer(main), 6)
        total += cost
        sides.append({
            "side": side,
            "configuration_name": main.configuration_name,
            "batch_id": main.id,
            "missing": len(missing),
            "estimated_cost_usd": cost,
            "task_ids": missing,
        })
    return {
        "benchmark_id": benchmark_id,
        "target_questions": len(target),
        "sides": sides,
        "total_estimated_cost_usd": round(total, 6),
    }


def public_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return {**plan, "sides": [{k: v for k, v in s.items() if k != "task_ids"} for s in plan["sides"]]}


_settle_lock = threading.Lock()
_settling: dict[str, Any] = {"active": False, "error": None}
POLL_SEC = 2.0


def _topup_request(plan_side: dict[str, Any], benchmark_id: str) -> BatchRequest:
    main = _batches.get(plan_side["batch_id"])
    if main is None or main.configuration is None:
        raise SettleError(
            f"The run for {plan_side['configuration_name']} has no saved configuration, so it can't be repeated."
        )
    ids = plan_side["task_ids"]
    return BatchRequest(
        configuration=main.configuration,
        mode=main.mode,  # type: ignore[arg-type]
        benchmark_id=benchmark_id,  # type: ignore[arg-type]
        task_ids=ids,
        size=len(ids),
        budget_usd=max(0.05, plan_side["estimated_cost_usd"] * 3),
        concurrency=4,
        passes=1,
        confirm=True,
        purpose="top-up",
    )


def settle(batches: list[BatchRun], benchmark_id: str) -> dict[str, Any]:
    """Start the top-up runs: the first now (so a refusal comes back to the caller), the
    rest one after another in the background (only one end-to-end run may run at a time)."""
    plan = settle_plan(batches, benchmark_id)
    requests = [_topup_request(s, benchmark_id) for s in plan["sides"] if s["task_ids"]]
    if not requests:
        raise SettleError("Both sides already have these questions.")
    if any(b.status == "running" for b in batches):
        raise SettleError("Another run is going. Wait for it to finish, then try again.", 409)
    with _settle_lock:
        if _settling["active"]:
            raise SettleError("This comparison is already being settled.", 409)
        try:
            first = _batches.start(requests[0])
        except RuntimeError as exc:
            raise SettleError(str(exc), 409) from exc
        _settling.update(active=True, error=None)
    threading.Thread(
        target=_run_rest, args=(first.id, requests[1:]), name=f"settle-{benchmark_id}", daemon=True
    ).start()
    return {"started": True, "batch_id": first.id, "plan": public_plan(plan)}


def _wait(batch_id: str) -> str | None:
    """Block until the run is no longer running or paused; its final status."""
    while True:
        b = _batches.get(batch_id)
        if b is None or b.status not in ("running", "paused"):
            return b.status if b else None
        time.sleep(POLL_SEC)


def _run_rest(first_id: str, rest: list[BatchRequest]) -> None:
    try:
        status = _wait(first_id)
        for req in rest:
            if status != "completed":  # cancelled or stopped: don't carry on spending
                _settling["error"] = f"A top-up run ended {status}; the rest were not started."
                return
            status = _wait(_batches.start(req).id)
    except Exception as exc:  # noqa: BLE001  nobody is waiting on a response any more
        _settling["error"] = f"{type(exc).__name__}: {exc}"
        print(f"[settle] stopped: {exc}", flush=True)
    finally:
        _settling["active"] = False

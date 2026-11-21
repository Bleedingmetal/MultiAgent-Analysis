"""The Overview: where each task stands, what changed, and what needs attention.

A quick look, not a leaderboard. Rules (docs: .impeccable/briefs/overview-and-lab.md):
- a task's result is judged from complete runs only: finished, every question graded, at least
  MIN_N questions; each configuration counts once, by its latest complete run;
- single vs multi-agent is compared only on the questions both ran, paired question by
  question, so a 10-question run and a 50-question run are compared on their shared 10;
- configurations the user hid stay out of the Overview (they remain under Runs and Compare).
"""

from __future__ import annotations

import json
import math
import statistics
import threading
from pathlib import Path
from typing import Any

from app.batches import BATCHES_DIR
from app.schemas import BatchItem, BatchRun

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


def complete(b: BatchRun) -> bool:
    s = b.summary
    return (
        b.status == "completed"
        and b.size >= MIN_N
        and s.passed + s.failed == b.size * max(1, b.passes)
    )


def _question_scores(b: BatchRun) -> dict[str, tuple[float, float, BatchItem]]:
    """task_id -> (score 0-1 averaged over passes, cost per answer, item) for graded questions."""
    out: dict[str, tuple[float, float, BatchItem]] = {}
    for item in b.items:
        graded = [a for a in item.attempts if a.status in ("passed", "failed")]
        if not graded:
            continue
        scores = [a.score if a.score is not None else (1.0 if a.status == "passed" else 0.0) for a in graded]
        out[item.task_id] = (statistics.fmean(scores), statistics.fmean(a.cost_usd for a in graded), item)
    return out


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


def compare(single: BatchRun, multi: BatchRun) -> dict[str, Any] | None:
    """Paired comparison on the questions both runs graded; None if too few are shared."""
    s_scores, m_scores = _question_scores(single), _question_scores(multi)
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
        return "still running"
    if b.status == "paused":
        return "paused at the budget check"
    if s.errors:
        return f"{s.errors} of {b.size} didn't run"
    if b.status != "completed" or s.passed + s.failed < b.size * max(1, b.passes):
        return "stopped early" + (f": {b.stop_reason}" if b.stop_reason else "")
    return None


def build(batches: list[BatchRun], task_counts: dict[str, int] | None = None) -> dict[str, Any]:
    hide = hidden()
    runs = [b for b in batches if b.configuration_id not in hide]  # newest first

    tasks = []
    for bench in dict.fromkeys(b.benchmark_id for b in runs):
        bench_runs = [b for b in runs if b.benchmark_id == bench]
        latest = _latest_complete_per_config(bench_runs)
        best = _best(latest)
        single = _best([b for b in latest if b.architecture == "single-agent"])
        multi = _best([b for b in latest if b.architecture != "single-agent"])
        tasks.append({
            "benchmark_id": bench,
            "task_count": (task_counts or {}).get(bench),
            "complete_runs": len(latest),
            "best": _figures(best) if best else None,
            "single": _figures(single) if single else None,
            "multi": _figures(multi) if multi else None,
            "comparison": compare(single, multi) if single and multi else None,
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
        key = (b.configuration_id, b.benchmark_id)
        if key in seen:
            continue
        seen.add(key)
        why = _not_finished_reason(b)
        if why and b.status not in ("running",):
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
    }

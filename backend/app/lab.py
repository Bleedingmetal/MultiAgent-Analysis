"""The Lab: problems worth looking into, the runs on one task, and what a change did.

Brief: .impeccable/briefs/lab.md. The maths of a run (accuracy, complete runs, question scores)
comes from app.overview, so the Lab and the Overview never disagree about a number.

- problems: each configuration's latest runs with the most failures, flaky questions, too-close
  single vs multi-agent comparisons and unfinished runs, in plain words;
- runs: every finished, graded run on one task (top-ups excluded);
- diff: run A (before) vs run B (after) on the questions both graded, paired question by
  question, with what flipped and what changed in the configuration;
- steadiness: how steady one setup is across all its runs. Separate runs of the same setup
  pool like passes of one run, so three one-pass runs give each question three tries.
"""

from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import datetime
from typing import Any

from app import overview
from app.overview import FINISHED, accuracy, complete, is_topup
from app.schemas import AgentConfiguration, BatchItem, BatchRun

MAX_PROBLEMS = 8
MIN_DIFF_SHARED = 5
MAX_FLIPS = 50

TASK_NAMES = {
    "finqa": "Financial calculation",
    "tau2-retail": "Customer service with tools",
    "tau-retail": "Customer service",
    "fab": "Finance research",
}

ARCH_NAMES = {
    "single-agent": "Single agent",
    "prompt-chaining": "Prompt chain",
    "routing": "Routing",
    "parallelization": "Parallel",
    "evaluator-optimizer": "Evaluator",
    "autonomous-agent": "Autonomous",
    "custom": "Custom",
}


def task_name(benchmark_id: str) -> str:
    return TASK_NAMES.get(benchmark_id, benchmark_id)


def arch_name(architecture: str | None) -> str:
    return ARCH_NAMES.get(architecture or "", architecture or "")


def _date(iso: str) -> str:
    try:
        d = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return ""
    return f"{d:%b} {d.day}"


def _detail(b: BatchRun, lead: str | None = None) -> str:
    parts = [lead, arch_name(b.architecture), ", ".join(b.models), _date(b.created_at)]
    return " · ".join(p for p in parts if p)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


# ---- runs -----------------------------------------------------------------------------


def run_point(b: BatchRun) -> dict[str, Any]:
    return {**overview._figures(b), "complete": complete(b)}


def _graded(b: BatchRun) -> bool:
    return b.summary.passed + b.summary.failed > 0


def runs(batches: list[BatchRun], benchmark_id: str) -> dict[str, Any]:
    """Every finished, graded, non-top-up run on one task, newest first."""
    rows = [
        run_point(b) for b in batches
        if b.benchmark_id == benchmark_id and b.status in FINISHED and _graded(b) and not is_topup(b)
    ]
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return {"benchmark_id": benchmark_id, "runs": rows}


# ---- problems -------------------------------------------------------------------------


def _problem(kind: str, title: str, detail: str, benchmark_id: str, configuration_id: str | None = None,
             batch_id: str | None = None, other_batch_id: str | None = None) -> dict[str, Any]:
    return {
        "kind": kind, "title": title, "detail": detail, "benchmark_id": benchmark_id,
        "configuration_id": configuration_id, "batch_id": batch_id, "other_batch_id": other_batch_id,
    }


def _latest_per_key(runs_: list[BatchRun], keep) -> list[BatchRun]:
    """Each (configuration, task)'s newest run that `keep` accepts. `runs_` is newest first."""
    seen: dict[tuple[str, str], BatchRun] = {}
    for b in runs_:
        key = (b.configuration_id, b.benchmark_id)
        if key not in seen and keep(b):
            seen[key] = b
    return list(seen.values())


def _partner(b: BatchRun, runs_: list[BatchRun]) -> str | None:
    """The run to look into `b` against: the one sharing the most graded questions with it.

    Enough shared questions to judge comes first, then the same configuration's earlier run
    (what changed over time), then the most shared, then the newest. None when nothing overlaps.
    """
    mine = set(overview._question_scores(b))
    if not mine:
        return None
    best: tuple | None = None
    best_id: str | None = None
    for o in runs_:
        if o.id == b.id or o.benchmark_id != b.benchmark_id or is_topup(o) or o.status not in FINISHED or not _graded(o):
            continue
        shared = len(mine & set(overview._question_scores(o)))
        if not shared:
            continue
        key = (shared >= overview.MIN_N, o.configuration_id == b.configuration_id and o.created_at < b.created_at,
               shared, o.created_at)
        if best is None or key > best:
            best, best_id = key, o.id
    return best_id


def _eligible(b: BatchRun) -> bool:
    return not is_topup(b) and b.status in FINISHED and _graded(b)


def _digest(value: Any) -> str:
    return hashlib.sha1(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:12]


_PROMPT_CACHE: dict[tuple[str, float], str] = {}


def _sent_prompt(b: BatchRun) -> str:
    """A digest of the system prompt the run actually sent (the app adds the task's own
    instructions at run time, so it is not in the saved configuration). Read from the
    run's first stored execution, as app.metrics groups them."""
    from app.batches import BATCHES_DIR  # here, not at import: batches imports this module's peers

    path = BATCHES_DIR / f"{b.id}.runs.jsonl"
    try:
        stamp = path.stat().st_mtime
    except OSError:
        return ""
    if (b.id, stamp) not in _PROMPT_CACHE:
        prompt = ""
        with path.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    run = json.loads(line)
                    steps = run.get("steps") or []
                    prompt = (steps[0].get("system_prompt") if steps else None) or run.get("system_prompt") or ""
                    break
        _PROMPT_CACHE[(b.id, stamp)] = _digest(prompt)
    return _PROMPT_CACHE[(b.id, stamp)]


def setup_key(b: BatchRun) -> tuple:
    """Runs with the same key ran exactly the same setup, so their results can pool.

    Any change makes a new setup: the configuration's contents (architecture, every step,
    its model, temperature and prompt, the connections), the mode, the models, and the
    system prompt actually sent. Pooling runs that differ would count a real change as noise.
    """
    cfg = b.configuration.model_dump() if b.configuration else {}
    layout = {k: cfg.get(k) for k in ("architecture", "nodes", "edges", "layers")}
    return (b.benchmark_id, b.configuration_id, b.mode, ",".join(b.models), _digest(layout), _sent_prompt(b))


def _setup_runs(b: BatchRun, runs_: list[BatchRun]) -> list[BatchRun]:
    """Every finished run of `b`'s setup (b included), oldest first."""
    key = setup_key(b)
    group = [o for o in runs_ if _eligible(o) and setup_key(o) == key]
    if b not in group:
        group.append(b)
    return sorted(group, key=lambda o: o.created_at)


def _tries(group: list[BatchRun]) -> dict[str, list[int]]:
    """task_id -> every graded try at it across the runs (1 right, 0 wrong), passes included."""
    out: dict[str, list[int]] = {}
    for run in group:
        for item in run.items:
            for a in item.attempts:
                if a.status in ("passed", "failed"):
                    right = a.score >= 1 if a.score is not None else a.status == "passed"
                    out.setdefault(item.task_id, []).append(int(right))
    return out


def steadiness(batches: list[BatchRun], batch_id: str) -> dict[str, Any]:
    """How steady a run's setup is across all its runs, on questions tried more than once."""
    b = next((x for x in batches if x.id == batch_id), None)
    if b is None:
        raise LabError(f"No run with id {batch_id}.", 404)
    group = _setup_runs(b, [x for x in batches if x.benchmark_id == b.benchmark_id])
    tries = {t: o for t, o in _tries(group).items() if len(o) > 1}
    always = sum(1 for o in tries.values() if all(o))
    never = sum(1 for o in tries.values() if not any(o))
    questions = {i.task_id: i.question for run in group for i in run.items}
    mixed = sorted(
        ((t, o) for t, o in tries.items() if 0 < sum(o) < len(o)),
        key=lambda x: abs(sum(x[1]) / len(x[1]) - 0.5),  # the closest to a coin flip first
    )
    counts = sorted({len(o) for o in tries.values()})
    return {
        "batch_id": b.id,
        "configuration_name": b.configuration_name,
        "runs": [{"batch_id": r.id, "created_at": r.created_at, "passes": r.passes, "accuracy": accuracy(r)} for r in group],
        "questions": len(tries),
        "tries_per_question": {"min": counts[0], "max": counts[-1]} if counts else None,
        "always_right": always,
        "never_right": never,
        "sometimes": len(mixed),
        # pass^3 (τ-bench): the chance three tries at a question are all right, averaged over questions
        "pass_hat_3": (
            statistics.fmean(math.comb(sum(o), 3) / math.comb(len(o), 3) for o in tries.values() if len(o) >= 3)
            if any(len(o) >= 3 for o in tries.values()) else None
        ),
        "mixed": [
            {"task_id": t, "question": questions.get(t), "right": sum(o), "tries": len(o)}
            for t, o in mixed[:MAX_FLIPS]
        ],
    }


def _is_mixed(item: BatchItem) -> bool:
    if item.status == "mixed":
        return True
    graded = {a.status for a in item.attempts if a.status in ("passed", "failed")}
    return len(graded) == 2


def _failures(runs_: list[BatchRun]) -> list[dict[str, Any]]:
    rows = []
    for b in _latest_per_key(runs_, complete):
        wrong = sum(1 for i in b.items if i.status == "failed")
        if not wrong:
            continue
        rows.append((accuracy(b) if accuracy(b) is not None else 1.0, -wrong, b, wrong))
    rows.sort(key=lambda r: (r[0], r[1]))
    return [
        _problem(
            "failures",
            f"{b.configuration_name} got {wrong} of {b.size} {task_name(b.benchmark_id)} questions wrong",
            _detail(b), b.benchmark_id, b.configuration_id, b.id, _partner(b, runs_),
        )
        for _, _, b, wrong in rows
    ]


def _flaky(runs_: list[BatchRun]) -> list[dict[str, Any]]:
    rows = []
    # Each setup once, through its newest run; its tries pool every run of that setup
    for b in _latest_per_key(runs_, _eligible):
        group = _setup_runs(b, runs_)
        tries = _tries(group)
        mixed = sum(1 for outcomes in tries.values() if len(outcomes) > 1 and 0 < sum(outcomes) < len(outcomes))
        if mixed:
            rows.append((mixed, b, group))
    rows.sort(key=lambda r: -r[0])
    out = []
    for mixed, b, group in rows:
        across = f"{len(group)} runs" if len(group) > 1 else f"{b.passes} passes"
        earlier = [g for g in group if g.id != b.id]
        out.append(_problem(
            "flaky",
            f"{b.configuration_name} gave different results on {_plural(mixed, task_name(b.benchmark_id) + ' question')}"
            f" across {across}",
            _detail(b, across), b.benchmark_id, b.configuration_id, b.id,
            # another run of the same setup when there is one, so the Lab shows run-to-run change
            earlier[-1].id if earlier else _partner(b, runs_),
        ))
    return out


def _too_close(runs_: list[BatchRun]) -> list[dict[str, Any]]:
    out = []
    for bench in dict.fromkeys(b.benchmark_id for b in runs_):
        bench_runs = [b for b in runs_ if b.benchmark_id == bench]
        _, single, multi = overview._sides(bench_runs)
        if not single or not multi:
            continue
        c = overview._compare_sides(bench_runs, single, multi)
        if not c.get("comparable") or c.get("verdict") != "too-close":
            continue
        more, cost = c.get("more_questions"), c.get("cost_to_settle_usd")
        if more:
            detail = f"About {_plural(more, 'more question')} each would settle it"
            if cost:
                detail += f", roughly ${cost:.2f}"
        else:
            detail = f"Compared on {c['shared']} shared questions"
        out.append(_problem(
            "too-close", f"Single vs multi-agent on {task_name(bench)} is too close to call", detail,
            bench, None, single.id, multi.id,
        ))
    return out


def _unfinished(runs_: list[BatchRun]) -> list[dict[str, Any]]:
    out = []
    for b in _latest_per_key(runs_, lambda b: not is_topup(b)):
        why = overview._not_finished_reason(b)
        finished_test = b.status == "completed" and b.size < overview.MIN_N  # nothing to act on
        if why and b.status != "running" and not finished_test:
            out.append(_problem(
                "unfinished", f"{b.configuration_name} on {task_name(b.benchmark_id)}: {why}",
                _detail(b), b.benchmark_id, b.configuration_id, b.id, _partner(b, runs_),
            ))
    return out


# How many of each kind come first; the rest fill any space left, in the same order
QUOTA = {"failures": 3, "flaky": 2, "too-close": 2, "unfinished": 2}


def problems(batches: list[BatchRun]) -> dict[str, Any]:
    _, runs_ = overview._visible(batches)  # hidden configurations stay out, as on the Overview
    by_kind = {
        "failures": _failures(runs_),
        "flaky": _flaky(runs_),
        "too-close": _too_close(runs_),
        "unfinished": _unfinished(runs_),
    }
    first = [p for kind, rows in by_kind.items() for p in rows[:QUOTA[kind]]]
    rest = [p for kind, rows in by_kind.items() for p in rows[QUOTA[kind]:]]
    return {"problems": (first + rest)[:MAX_PROBLEMS]}


# ---- what changed in the configuration --------------------------------------------------


def _s(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _node_fields(node) -> dict[str, Any]:
    """Label suffix -> value for the parts of a node worth reporting."""
    ms = node.modelSettings
    meta = node.metadata or {}
    step = node.promptStep
    router = node.routerSettings
    return {
        "type": node.type,
        "provider": ms.provider if ms else None,
        "model": ms.model if ms else None,
        "system prompt": ms.systemPrompt if ms else None,
        "temperature": ms.temperature if ms else None,
        "role": meta.get("role"),
        "instructions": meta.get("instructions") or (step.instructions if step else None)
        or (router.instructions if router else None),
        "objective": step.objective if step else None,
    }


def _nodes_by_name(cfg: AgentConfiguration) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for n in sorted(cfg.nodes, key=lambda n: n.order):
        name, k = n.name, 2
        while name in out:
            name, k = f"{n.name} ({k})", k + 1
        out[name] = n
    return out


def config_changes(a: BatchRun, b: BatchRun, ca: AgentConfiguration | None,
                   cb: AgentConfiguration | None) -> list[dict[str, Any]]:
    """Human-readable differences between the two runs' configuration snapshots."""
    if ca is None and cb is None:
        return []
    changes: list[dict[str, Any]] = []

    def add(what: str, before: Any, after: Any) -> None:
        before, after = _s(before), _s(after)
        if before != after:
            changes.append({"what": what, "before": before, "after": after})

    if a.configuration_id != b.configuration_id:
        add("Configuration", a.configuration_name, b.configuration_name)
    add("Architecture", arch_name(ca.architecture if ca else a.architecture),
        arch_name(cb.architecture if cb else b.architecture))
    if ca is None or cb is None:
        # only one snapshot saved: compare what the runs themselves record
        add("Models", ", ".join(a.models), ", ".join(b.models))
        return changes

    na, nb = _nodes_by_name(ca), _nodes_by_name(cb)
    for name in na:
        if name not in nb:
            changes.append({"what": "Node removed", "before": name, "after": None})
    for name in nb:
        if name not in na:
            changes.append({"what": "Node added", "before": None, "after": name})
    for name in na:
        if name not in nb:
            continue
        fa, fb = _node_fields(na[name]), _node_fields(nb[name])
        for field in fa:
            add(f"{name} {field}", fa[field], fb[field])
    add("Layers", len(ca.layers), len(cb.layers))
    return changes


# ---- diff -----------------------------------------------------------------------------


class LabError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _first_graded(item: BatchItem):
    return next((x for x in item.attempts if x.status in ("passed", "failed")), None)


def _mean_latency(item: BatchItem) -> float | None:
    graded = [x.latency_sec for x in item.attempts if x.status in ("passed", "failed")]
    return statistics.fmean(graded) if graded else None


def _rel(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or a == 0:
        return None
    return (b - a) / a


def diff(a: BatchRun, b: BatchRun) -> dict[str, Any]:
    """Run A (before) vs run B (after) on the questions both graded. Raises LabError."""
    if a.benchmark_id != b.benchmark_id:
        raise LabError(
            f"These runs are on different tasks ({task_name(a.benchmark_id)} and {task_name(b.benchmark_id)}), "
            "so they can't be compared question by question."
        )
    sa, sb = overview._question_scores(a), overview._question_scores(b)
    shared = [t for t in sa if t in sb]
    n = len(shared)
    comparable = n >= MIN_DIFF_SHARED

    acc_a = statistics.fmean(sa[t][0] for t in shared) if n else None
    acc_b = statistics.fmean(sb[t][0] for t in shared) if n else None
    cost_a = sum(sa[t][1] for t in shared)
    cost_b = sum(sb[t][1] for t in shared)
    right_a = sum(sa[t][0] for t in shared)
    right_b = sum(sb[t][0] for t in shared)
    cpc_a = cost_a / right_a if right_a else None
    cpc_b = cost_b / right_b if right_b else None
    lat_a = [v for t in shared if (v := _mean_latency(sa[t][2])) is not None]
    lat_b = [v for t in shared if (v := _mean_latency(sb[t][2])) is not None]
    time_a = statistics.fmean(lat_a) if lat_a else None
    time_b = statistics.fmean(lat_b) if lat_b else None

    # paired test, as overview.compare
    verdict, more, settle_cost = "not-comparable", None, None
    if comparable:
        diffs = [sb[t][0] - sa[t][0] for t in shared]
        mean = statistics.fmean(diffs)
        sd = statistics.stdev(diffs) if n > 1 else 0.0
        se = sd / math.sqrt(n)
        if mean == 0:
            verdict = "no-change"
        elif se == 0 or abs(mean) > 1.96 * se:
            verdict = "real"
        else:
            verdict = "too-close"
            more = max(0, math.ceil((1.96 * sd / abs(mean)) ** 2) - n)
            settle_cost = round(more * (cost_a + cost_b) / n, 4) if more else None

    def flip(t: str) -> dict[str, Any]:
        ia, ib = sa[t][2], sb[t][2]
        fa, fb = _first_graded(ia), _first_graded(ib)
        return {
            "task_id": t,
            "question": ia.question,
            "a_score": round(sa[t][0], 4),
            "b_score": round(sb[t][0], 4),
            "a_answer": fa.scored_answer if fa else ia.scored_answer,
            "b_answer": fb.scored_answer if fb else ib.scored_answer,
            "a_run_id": (fa.run_id if fa else None) or ia.run_id,
            "b_run_id": (fb.run_id if fb else None) or ib.run_id,
        }

    fixed = sorted((t for t in shared if sb[t][0] > sa[t][0]), key=lambda t: -(sb[t][0] - sa[t][0]))
    broke = sorted((t for t in shared if sb[t][0] < sa[t][0]), key=lambda t: -(sa[t][0] - sb[t][0]))
    same = [t for t in shared if sb[t][0] == sa[t][0]]
    still_right = sum(1 for t in same if sa[t][0] >= 1)

    changes = config_changes(a, b, a.configuration, b.configuration)
    same_setup = setup_key(a) == setup_key(b)
    if not changes and not same_setup:
        # Nothing in the saved configuration differs, but the runs did not run the same thing:
        # the system prompt the app sent (or the mode) changed between them
        if _sent_prompt(a) != _sent_prompt(b):
            changes.append({"what": "System prompt sent", "before": "earlier version", "after": "newer version"})
        else:
            changes.append({"what": "Run settings", "before": a.mode, "after": b.mode})
    return {
        "a": run_point(a),
        "b": run_point(b),
        "shared": n,
        "comparable": comparable,
        "accuracy": {
            "a": acc_a,
            "b": acc_b,
            "points": (acc_b - acc_a) * 100 if n else None,
            "relative": _rel(acc_a, acc_b),
        },
        "cost_per_correct": {"a": cpc_a, "b": cpc_b, "relative": _rel(cpc_a, cpc_b)},
        "time_per_question": {
            "a": time_a,
            "b": time_b,
            "relative": _rel(time_a, time_b),
            "seconds": time_b - time_a if time_a is not None and time_b is not None else None,
        },
        "verdict": verdict,
        "more_questions": more,
        "cost_to_settle_usd": settle_cost,
        "fixed": [flip(t) for t in fixed[:MAX_FLIPS]],
        "broke": [flip(t) for t in broke[:MAX_FLIPS]],
        "still_wrong": len(same) - still_right,
        "still_right": still_right,
        "changes": changes,
        "same_config": same_setup,
    }

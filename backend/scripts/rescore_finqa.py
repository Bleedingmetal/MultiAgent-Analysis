"""Re-score stored FinQA answers with the current scorer.

Run after a change to FinQA scoring so stored runs and batch summaries agree with it:

    python scripts/rescore_finqa.py            # report what would change
    python scripts/rescore_finqa.py --write    # back up data/, then rewrite

Only `success`, the attempt and item statuses and the batch summaries change; answers,
costs, latencies and traces are left as they were. Stop the backend before --write, and
start it again after, since it keeps batches in memory.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.batches import BATCHES_DIR, _aggregate_status, summarize  # noqa: E402
from app.datasets.registry import get_task  # noqa: E402
from app.runners.execute import score_task_output  # noqa: E402
from app.schemas import BatchRun, RunResult  # noqa: E402
from app.store import RUNS_FILE  # noqa: E402


def rescore(run: RunResult) -> bool | None:
    """The run's success under the current scorer, or its old value if it cannot be re-scored."""
    if run.benchmark_id != "finqa" or run.status != "completed" or not run.answer:
        return run.success
    try:
        task = get_task("finqa", run.task_id)
    except KeyError:
        return run.success
    return score_task_output(task, run.answer).success


def refresh_comparison(run: RunResult) -> bool:
    """Recompute the run's reasoning comparison with the current checker; True if it changed."""
    if run.benchmark_id != "finqa" or not run.answer:
        return False
    try:
        task = get_task("finqa", run.task_id)
    except KeyError:
        return False
    fresh = score_task_output(task, run.answer).comparison
    before = run.reasoning_comparison.model_dump() if run.reasoning_comparison else None
    after = fresh.model_dump() if fresh else None
    if before == after:
        return False
    run.reasoning_comparison = fresh
    return True


# Scoring sentences an older scorer wrote into run notes; refreshed from the current one.
_SCORING_NOTES = re.compile(
    r"(Disputed label:.*?Any of these is accepted\.|FinQA gives more than one answer here.*?Any of them is accepted\."
    r"|FinQA's own question text is cut off.*?gold program\.|FinQA's answer key .*?scored here as [^ ]+?\.)"
)


def refresh_labels(run: RunResult) -> bool:
    """Bring the run's expected answer, alternate-answer flag and scoring note up to date."""
    if run.benchmark_id != "finqa" or not run.answer:
        return False
    try:
        task = get_task("finqa", run.task_id)
    except KeyError:
        return False
    scored = score_task_output(task, run.answer)
    base = " ".join(_SCORING_NOTES.sub("", run.note or "").split())
    note = " ".join(x for x in (base, scored.note or "") if x) or None
    before = (run.note, run.label_disputed, run.expected_display, run.expected_answer)
    run.note, run.label_disputed = note, scored.label_disputed
    run.expected_display, run.expected_answer = task.expected_display, task.expected_answer
    return before != (run.note, run.label_disputed, run.expected_display, run.expected_answer)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    if args.write:
        backup = ROOT / "data" / f"backup-before-rescore-{datetime.now():%Y%m%d-%H%M%S}"
        shutil.copytree(BATCHES_DIR, backup / "batches")
        if RUNS_FILE.exists():
            (backup / "runs").mkdir(parents=True, exist_ok=True)
            shutil.copy2(RUNS_FILE, backup / "runs" / RUNS_FILE.name)
        print(f"backup: {backup}")

    for meta in sorted(BATCHES_DIR.glob("*.json")):
        batch = BatchRun.model_validate_json(meta.read_text(encoding="utf-8"))
        if batch.benchmark_id != "finqa":
            continue
        runs_path = BATCHES_DIR / f"{batch.id}.runs.jsonl"
        if not runs_path.exists():
            continue
        runs = [RunResult.model_validate_json(line) for line in runs_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        changed: dict[str, bool | None] = {}
        refreshed = sum(refresh_comparison(run) for run in runs)
        labels = {run.id: run for run in runs if refresh_labels(run)}
        refreshed += len(labels)
        if labels:
            by_run = {r.id: r for r in runs}
            for item in batch.items:
                first = by_run.get(item.run_id or "")
                if first is not None:
                    item.expected_display = first.expected_display
                    item.label_disputed = any(
                        by_run[a.run_id].label_disputed for a in item.attempts if a.run_id in by_run
                    ) or first.label_disputed
            batch.summary.disputed = sum(1 for i in batch.items if i.label_disputed and i.attempts)
        # Carry each run's (refreshed) calculation check into the batch's own tally
        matches = {
            r.id: r.reasoning_comparison.execution_matches_expected if r.reasoning_comparison else None
            for r in runs
        }
        tally_changed = False
        for item in batch.items:
            for attempt in item.attempts:
                if attempt.run_id in matches and attempt.program_match != matches[attempt.run_id]:
                    attempt.program_match = matches[attempt.run_id]
                    tally_changed = True
            if item.attempts:
                item.program_match = item.attempts[0].program_match
        if tally_changed:
            programs = [a.program_match for i in batch.items for a in i.attempts if a.program_match is not None]
            batch.summary.program_match_rate = sum(programs) / len(programs) if programs else None
            refreshed += 1
        for run in runs:
            new = rescore(run)
            if new != run.success:
                changed[run.id] = new
                run.success = new
        if refreshed and not changed:
            print(f"{batch.id} {batch.configuration_name}: {refreshed} notes or comparisons refreshed")
            if args.write:
                runs_path.write_text("".join(r.model_dump_json() + "\n" for r in runs), encoding="utf-8")
                meta.write_text(batch.model_dump_json(), encoding="utf-8")
            continue
        if not changed:
            continue

        before = batch.summary.pass_rate
        for item in batch.items:
            for attempt in item.attempts:
                if attempt.run_id in changed:
                    attempt.success = changed[attempt.run_id]
                    attempt.status = "passed" if attempt.success else "failed"  # type: ignore[assignment]
            if item.attempts:
                first = item.attempts[0]
                item.success = first.success
                item.passes_passed = sum(1 for a in item.attempts if a.status == "passed")
                item.passes_failed = sum(1 for a in item.attempts if a.status == "failed")
                if item.status not in {"pending", "running", "skipped"}:
                    item.status = _aggregate_status(item)  # type: ignore[assignment]
        old = batch.summary
        if any(item.attempts for item in batch.items):
            batch.summary = summarize(batch, elapsed_sec=old.elapsed_sec, tokens=(old.prompt_tokens, old.completion_tokens))
            batch.summary.projected_cost_usd = old.projected_cost_usd
        else:
            # Batches from before per-pass attempts: one run per item, counted on the item itself.
            for item in batch.items:
                if item.run_id in changed:
                    item.success = changed[item.run_id]
                    item.status = "passed" if item.success else "failed"  # type: ignore[assignment]
            passed = sum(1 for i in batch.items if i.status == "passed")
            failed = sum(1 for i in batch.items if i.status == "failed")
            old.passed, old.failed = passed, failed
            old.pass_rate = passed / (passed + failed) if passed + failed else None
            old.cost_per_pass_usd = round(old.cost_usd / passed, 6) if passed else None
            batch.summary = old
        print(f"{batch.id} {batch.configuration_name}: {len(changed)} answers changed, pass rate {before} -> {batch.summary.pass_rate}")

        if args.write:
            runs_path.write_text("".join(r.model_dump_json() + "\n" for r in runs), encoding="utf-8")
            meta.write_text(batch.model_dump_json(), encoding="utf-8")

    # single-question runs
    if RUNS_FILE.exists():
        lines = [line for line in RUNS_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
        out, n = [], 0
        refreshed = 0
        for line in lines:
            run = RunResult.model_validate_json(line)
            refreshed += refresh_comparison(run)
            refreshed += refresh_labels(run)
            new = rescore(run)
            if new != run.success:
                run.success = new
                n += 1
            out.append(run.model_dump_json())
        print(f"single runs: {n} changed, {refreshed} reasoning comparisons refreshed")
        if args.write and (n or refreshed):
            RUNS_FILE.write_text("".join(o + "\n" for o in out), encoding="utf-8")


if __name__ == "__main__":
    main()

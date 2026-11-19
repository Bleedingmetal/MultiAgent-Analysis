"""Re-run a few tasks (FinQA questions or τ² conversations) with the configuration a stored batch used.

For checking a fix on the questions it touches, without a full batch:

    python scripts/spot_rerun.py E2E-3575B5BB IP/2006/page_30.pdf-2 GS/2017/page_179.pdf-1

It counts as one run against the daily cap and records its spend like a batch does.
The results are printed, not saved to the run history.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import spend_guard  # noqa: E402
from app.batches import BATCHES_DIR  # noqa: E402
from app.datasets.registry import final_answer_span, get_task  # noqa: E402
from app.runners.dispatch import execute  # noqa: E402
from app.schemas import BatchRun, RunResult  # noqa: E402


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    batch_id, task_ids = sys.argv[1], sys.argv[2:]
    batch = BatchRun.model_validate_json((BATCHES_DIR / f"{batch_id}.json").read_text(encoding="utf-8"))
    runs_file = BATCHES_DIR / f"{batch_id}.runs.jsonl"
    first = RunResult.model_validate_json(runs_file.read_text(encoding="utf-8").splitlines()[0])
    config = first.configuration
    if config is None:
        sys.exit(f"{batch_id} has no stored configuration snapshot.")

    spend_guard.begin_batch()
    total = 0.0
    print(f"{batch.configuration_name} ({batch.architecture}, {', '.join(batch.models)}), mode {batch.mode}\n")
    for task_id in task_ids:
        task = get_task(batch.benchmark_id, task_id)
        meter = spend_guard.RunMeter()
        result = execute(config, task, mode=batch.mode, meter=meter)
        spend_guard.record_spend(result.cost_usd)
        total += result.cost_usd
        verdict = "PASS" if result.success else "FAIL" if result.success is False else "—"
        print(f"{verdict}  {task_id}")
        print(f"      question: {task.question}")
        print(f"      gold:     {task.expected_display or task.expected_answer}")
        print(f"      said:     {final_answer_span(result.answer or result.error or '')}")
        print(f"      ${result.cost_usd:.4f}, {result.latency_sec:.1f}s\n")
    print(f"total ${total:.4f}")


if __name__ == "__main__":
    main()

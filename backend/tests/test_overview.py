import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import overview
from app.schemas import BatchAttempt, BatchItem, BatchRun, BatchSummary


def batch(bid: str, config: str, arch: str, outcomes: list[bool], *, created: str, status: str = "completed",
          cost: float = 0.001, ids: list[str] | None = None) -> BatchRun:
    ids = ids or [f"q{i}" for i in range(len(outcomes))]
    items = [
        BatchItem(index=i, task_id=t, question=f"question {t}", status="passed" if ok else "failed",
                  attempts=[BatchAttempt(pass_index=0, status="passed" if ok else "failed", cost_usd=cost)])
        for i, (t, ok) in enumerate(zip(ids, outcomes))
    ]
    passed = sum(outcomes)
    return BatchRun(
        id=bid, configuration_id=config, configuration_name=config, architecture=arch, mode="pipeline",
        benchmark_id="finqa", size=len(outcomes), budget_usd=1, concurrency=1, status=status, created_at=created,
        items=items,
        summary=BatchSummary(total=len(outcomes), done=len(outcomes), passed=passed, failed=len(outcomes) - passed,
                             pass_rate=passed / len(outcomes), cost_usd=cost * len(outcomes),
                             cost_per_pass_usd=cost * len(outcomes) / passed if passed else None),
    )


class CompareTests(unittest.TestCase):
    def test_compares_only_shared_questions(self) -> None:
        single = batch("S", "single", "single-agent", [True] * 10, created="2026-11-01")
        # 50 questions; its first 10 (shared) go 8 of 10, the rest all pass
        multi = batch("M", "multi", "evaluator-optimizer", [True] * 8 + [False] * 2 + [True] * 40, created="2026-11-02")
        c = overview.compare(single, multi)
        self.assertEqual(c["shared"], 10)
        self.assertAlmostEqual(c["multi_accuracy"], 0.8)  # not its 96% over all 50
        self.assertAlmostEqual(c["difference"], -0.2)
        self.assertEqual([q["task_id"] for q in c["multi_lost"]], ["q8", "q9"])

    def test_too_few_shared_is_not_comparable(self) -> None:
        a = batch("A", "a", "single-agent", [True] * 10, created="1", ids=[f"a{i}" for i in range(10)])
        b = batch("B", "b", "routing", [True] * 10, created="2", ids=[f"b{i}" for i in range(10)])
        self.assertEqual(overview.compare(a, b), {"shared": 0, "comparable": False})

    def test_large_consistent_gap_is_settled(self) -> None:
        single = batch("S", "s", "single-agent", [True] * 30, created="1")
        multi = batch("M", "m", "routing", [False] * 30, created="2")
        self.assertEqual(overview.compare(single, multi)["verdict"], "settled")


class BuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(overview, "HIDDEN_FILE", Path(self.tmp.name) / "hidden.json")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_partial_runs_never_lead_and_hidden_configs_leave(self) -> None:
        runs = [
            batch("P", "partial", "routing", [True] * 10, created="3", status="stopped"),
            batch("M", "multi", "routing", [True] * 9 + [False], created="2"),
            batch("S", "single", "single-agent", [True] * 8 + [False] * 2, created="1"),
        ]
        task = overview.build(runs)["tasks"][0]
        self.assertEqual(task["best"]["batch_id"], "M")  # the stopped 100% run is not used
        overview.set_hidden("multi", True)
        task = overview.build(runs)["tasks"][0]
        self.assertEqual(task["best"]["batch_id"], "S")
        self.assertIsNone(task["multi"])


if __name__ == "__main__":
    unittest.main()

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


def topup(bid: str, config: str, arch: str, outcomes: list[bool], ids: list[str], *, created: str) -> BatchRun:
    return batch(bid, config, arch, outcomes, created=created, ids=ids).model_copy(update={"purpose": "top-up"})


class TopUpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(overview, "HIDDEN_FILE", Path(self.tmp.name) / "hidden.json")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def runs(self, *extra: BatchRun) -> list[BatchRun]:
        # single ran q0-q9; multi ran q0-q49. Shared 10: 9 of 10 vs 8 of 10, too close to call
        single = batch("S", "single", "single-agent", [True] * 9 + [False], created="2026-11-01")
        multi = batch("M", "multi", "evaluator-optimizer", [True] * 8 + [False, False] + [True] * 40,
                      created="2026-11-02")
        return sorted([*extra, single, multi], key=lambda b: b.created_at, reverse=True)

    def test_topup_is_pooled_into_the_comparison(self) -> None:
        before = overview.build(self.runs())["tasks"][0]["comparison"]
        self.assertEqual(before["shared"], 10)
        self.assertEqual(before["verdict"], "too-close")
        extra = topup("T", "single", "single-agent", [True] * 8, [f"q{i}" for i in range(10, 18)], created="2026-11-03")
        after = overview.build(self.runs(extra))["tasks"][0]["comparison"]
        self.assertEqual(after["shared"], 18)
        self.assertAlmostEqual(after["single_accuracy"], 17 / 18)

    def test_question_in_main_and_topup_takes_the_mean(self) -> None:
        extra = topup("T", "single", "single-agent", [True], ["q9"], created="2026-11-03")  # q9 failed in S
        c = overview.build(self.runs(extra))["tasks"][0]["comparison"]
        self.assertEqual(c["shared"], 10)
        self.assertAlmostEqual(c["single_accuracy"], 9.5 / 10)

    def test_topup_is_never_the_main_run(self) -> None:
        # a newer, complete-sized, perfect top-up must not stand for its configuration
        extra = topup("T", "single", "single-agent", [True] * 12, [f"q{i}" for i in range(12)], created="2026-11-09")
        out = overview.build(self.runs(extra))
        task = out["tasks"][0]
        self.assertEqual(task["single"]["batch_id"], "S")
        self.assertEqual(task["complete_runs"], 2)
        self.assertFalse(overview.complete(extra))
        self.assertEqual(out["recent"][0]["not_finished"], "top-up for the comparison")
        self.assertFalse(any(a.get("batch_id") == "T" for a in out["attention"]))

    def test_settle_plan_counts_missing_questions_per_side(self) -> None:
        sample = [mock.Mock(id=f"q{i}") for i in range(50)]
        with mock.patch.object(overview.registry, "sample_tasks", side_effect=lambda _b, n: sample[:n]):
            c = overview.build(self.runs())["tasks"][0]["comparison"]
            plan = overview.settle_plan(self.runs(), "finqa")
        target = c["shared"] + c["more_questions"]
        self.assertEqual(plan["target_questions"], target)
        single, multi = plan["sides"]
        self.assertEqual((single["side"], single["missing"]), ("single", target - 10))
        self.assertEqual(single["task_ids"], [f"q{i}" for i in range(10, target)])
        self.assertEqual((multi["side"], multi["configuration_name"], multi["missing"]), ("multi", "multi", 0))
        # 0.001 per answer (cost / answers, no avg_cost_usd on these runs)
        self.assertAlmostEqual(single["estimated_cost_usd"], (target - 10) * 0.001)
        self.assertNotIn("task_ids", overview.public_plan(plan)["sides"][0])

    def test_settle_refuses_a_settled_comparison(self) -> None:
        single = batch("S", "s", "single-agent", [True] * 30, created="1")
        multi = batch("M", "m", "routing", [False] * 30, created="2")
        with self.assertRaises(overview.SettleError):
            overview.settle_plan([multi, single], "finqa")


if __name__ == "__main__":
    unittest.main()

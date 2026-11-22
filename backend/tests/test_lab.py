import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import lab, overview
from app.schemas import (
    AgentConfiguration, BatchAttempt, BatchItem, BatchRun, BatchSummary, ConfigurationNode, ModelSettings,
)


def batch(bid: str, config: str, arch: str, outcomes: list[bool], *, created: str = "2026-11-16T10:00:00",
          ids: list[str] | None = None, cost: float = 0.001, latency: float = 1.0,
          configuration: AgentConfiguration | None = None) -> BatchRun:
    ids = ids or [f"q{i}" for i in range(len(outcomes))]
    items = [
        BatchItem(index=i, task_id=t, question=f"question {t}", status="passed" if ok else "failed",
                  attempts=[BatchAttempt(pass_index=0, status="passed" if ok else "failed", cost_usd=cost,
                                         latency_sec=latency, run_id=f"RUN-{bid}-{t}", scored_answer=f"{bid}:{t}")])
        for i, (t, ok) in enumerate(zip(ids, outcomes))
    ]
    passed = sum(outcomes)
    return BatchRun(
        id=bid, configuration_id=config, configuration_name=config, architecture=arch, mode="pipeline",
        benchmark_id="finqa", size=len(outcomes), budget_usd=1, concurrency=1, status="completed",
        created_at=created, items=items, models=["claude-haiku-5-5"], configuration=configuration,
        summary=BatchSummary(total=len(outcomes), done=len(outcomes), passed=passed, failed=len(outcomes) - passed,
                             pass_rate=passed / len(outcomes), cost_usd=cost * len(outcomes),
                             cost_per_pass_usd=cost * len(outcomes) / passed if passed else None,
                             avg_latency_sec=latency),
    )


def two_pass(bid: str, config: str, pattern: list[tuple[bool, bool]], created: str = "2026-11-16T10:00:00") -> BatchRun:
    items = []
    for i, (p0, p1) in enumerate(pattern):
        atts = [BatchAttempt(pass_index=k, status="passed" if ok else "failed") for k, ok in enumerate((p0, p1))]
        status = "passed" if p0 and p1 else "failed" if not p0 and not p1 else "mixed"
        items.append(BatchItem(index=i, task_id=f"q{i}", question=f"q{i}", status=status, attempts=atts))
    passed = sum(p0 + p1 for p0, p1 in pattern)
    total = 2 * len(pattern)
    return BatchRun(
        id=bid, configuration_id=config, configuration_name=config, architecture="evaluator-optimizer",
        mode="pipeline", benchmark_id="finqa", size=len(pattern), budget_usd=1, concurrency=1, passes=2,
        status="completed", created_at=created, items=items,
        summary=BatchSummary(total=len(pattern), done=len(pattern), passes=2, passed=passed,
                             failed=total - passed, pass_rate=passed / total),
    )


def config(cid: str, *, prompt: str, model: str, arch: str = "single-agent") -> AgentConfiguration:
    return AgentConfiguration(
        id=cid, name=cid, architecture=arch, layers=[{"id": "l1"}],
        nodes=[ConfigurationNode(id="n1", name="Agent 1", type="model", layerId="l1",
                                 modelSettings=ModelSettings(provider="anthropic", model=model, systemPrompt=prompt))],
    )


class DiffTests(unittest.TestCase):
    def test_shared_questions_only_with_flips(self) -> None:
        # A: 20 questions, q0-q9 right, q10-q19 wrong. B: only q0-q14 plus 5 of its own.
        a = batch("A", "c", "single-agent", [True] * 10 + [False] * 10, cost=0.001, latency=1.0)
        b_out = [True] * 8 + [False] * 2 + [True] * 5 + [True] * 5
        b_ids = [f"q{i}" for i in range(15)] + [f"x{i}" for i in range(5)]
        b = batch("B", "c", "single-agent", b_out, ids=b_ids, cost=0.002, latency=1.5)
        d = lab.diff(a, b)
        self.assertEqual(d["shared"], 15)
        self.assertTrue(d["comparable"])
        # shared: A 10/15 right, B 13/15
        self.assertAlmostEqual(d["accuracy"]["a"], 10 / 15)
        self.assertAlmostEqual(d["accuracy"]["b"], 13 / 15)
        self.assertAlmostEqual(d["accuracy"]["points"], 20.0)
        self.assertAlmostEqual(d["accuracy"]["relative"], 0.3)
        self.assertEqual(sorted(f["task_id"] for f in d["fixed"]), ["q10", "q11", "q12", "q13", "q14"])
        self.assertEqual([f["task_id"] for f in d["broke"]], ["q8", "q9"])
        self.assertEqual(d["still_right"], 8)
        self.assertEqual(d["still_wrong"], 0)
        flip = d["fixed"][0]
        self.assertEqual((flip["a_score"], flip["b_score"]), (0.0, 1.0))
        self.assertEqual(flip["b_run_id"], f"RUN-B-{flip['task_id']}")
        self.assertAlmostEqual(d["cost_per_correct"]["a"], 0.015 / 10)
        self.assertAlmostEqual(d["cost_per_correct"]["b"], 0.030 / 13)
        self.assertAlmostEqual(d["time_per_question"]["seconds"], 0.5)
        self.assertAlmostEqual(d["time_per_question"]["relative"], 0.5)
        self.assertTrue(d["same_config"])
        self.assertEqual(d["changes"], [])

    def test_large_consistent_gap_is_real(self) -> None:
        a = batch("A", "c", "single-agent", [False] * 20)
        b = batch("B", "c", "single-agent", [True] * 18 + [False] * 2)
        self.assertEqual(lab.diff(a, b)["verdict"], "real")

    def test_small_gap_is_too_close(self) -> None:
        a = batch("A", "c", "single-agent", [True] * 9 + [False] + [True] * 10)
        b = batch("B", "c", "single-agent", [True] * 10 + [False] + [True] * 7 + [False, True])
        d = lab.diff(a, b)
        self.assertEqual(d["verdict"], "too-close")
        self.assertGreater(d["more_questions"], 0)
        self.assertIsNotNone(d["cost_to_settle_usd"])

    def test_identical_results_are_no_change_and_few_are_not_comparable(self) -> None:
        a = batch("A", "c", "single-agent", [True] * 10)
        self.assertEqual(lab.diff(a, batch("B", "c", "single-agent", [True] * 10))["verdict"], "no-change")
        few = lab.diff(batch("A", "c", "single-agent", [True] * 4), batch("B", "c", "single-agent", [False] * 4))
        self.assertFalse(few["comparable"])
        self.assertEqual(few["verdict"], "not-comparable")

    def test_different_tasks_refused(self) -> None:
        a = batch("A", "c", "single-agent", [True] * 10)
        b = batch("B", "c", "single-agent", [True] * 10).model_copy(update={"benchmark_id": "fab"})
        with self.assertRaises(lab.LabError):
            lab.diff(a, b)


class ChangesTests(unittest.TestCase):
    def test_prompt_and_model_changes_listed(self) -> None:
        a = batch("A", "c", "single-agent", [True] * 10,
                  configuration=config("c", prompt="Answer briefly.", model="claude-haiku-5-5"))
        b = batch("B", "c", "single-agent", [True] * 10,
                  configuration=config("c", prompt="Give one number.", model="claude-sonnet-5-5"))
        d = lab.diff(a, b)
        changes = {c["what"]: (c["before"], c["after"]) for c in d["changes"]}
        self.assertEqual(changes["Agent 1 system prompt"], ("Answer briefly.", "Give one number."))
        self.assertEqual(changes["Agent 1 model"], ("claude-haiku-5-5", "claude-sonnet-5-5"))
        self.assertEqual(len(changes), 2)
        self.assertFalse(d["same_config"])

    def test_same_configuration_has_no_changes(self) -> None:
        cfg = config("c", prompt="Answer briefly.", model="claude-haiku-5-5")
        a = batch("A", "c", "single-agent", [True] * 10, configuration=cfg)
        b = batch("B", "c", "single-agent", [False] * 10, configuration=cfg)
        d = lab.diff(a, b)
        self.assertEqual(d["changes"], [])
        self.assertTrue(d["same_config"])

    def test_architecture_change_named(self) -> None:
        a = batch("A", "s", "single-agent", [True] * 10, configuration=config("s", prompt="p", model="m"))
        b = batch("B", "e", "evaluator-optimizer", [True] * 10,
                  configuration=config("e", prompt="p", model="m", arch="evaluator-optimizer"))
        changes = {c["what"]: (c["before"], c["after"]) for c in lab.diff(a, b)["changes"]}
        self.assertEqual(changes["Architecture"], ("Single agent", "Evaluator"))


class ProblemsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(overview, "HIDDEN_FILE", Path(self.tmp.name) / "hidden.json")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_flaky_run_listed_and_hidden_configs_excluded(self) -> None:
        flaky = two_pass("F", "Evaluator", [(True, False)] * 6 + [(True, True)] * 6)
        weak = batch("W", "weak", "single-agent", [True] * 3 + [False] * 7, created="2026-11-15T10:00:00")
        found = lab.problems([flaky, weak])["problems"]
        kinds = {(p["kind"], p["batch_id"]) for p in found}
        self.assertIn(("flaky", "F"), kinds)
        self.assertIn(("failures", "W"), kinds)
        title = next(p["title"] for p in found if p["kind"] == "flaky")
        self.assertEqual(title, "Evaluator gave different results on 6 Financial calculation questions across 2 passes")
        fail = next(p for p in found if p["kind"] == "failures")
        self.assertEqual(fail["title"], "weak got 7 of 10 Financial calculation questions wrong")
        self.assertEqual(fail["detail"], "Single agent · claude-haiku-5-5 · Nov 15")

        overview.set_hidden("Evaluator", True)
        found = lab.problems([flaky, weak])["problems"]
        self.assertFalse(any(p["configuration_id"] == "Evaluator" for p in found))
        self.assertTrue(any(p["batch_id"] == "W" for p in found))

    def test_runs_lists_finished_graded_non_topups(self) -> None:
        keep = batch("K", "c", "single-agent", [True] * 10, created="2")
        top = batch("T", "c", "single-agent", [True] * 10, created="3").model_copy(update={"purpose": "top-up"})
        live = batch("L", "c", "single-agent", [True] * 10, created="4").model_copy(update={"status": "running"})
        rows = lab.runs([live, top, keep], "finqa")["runs"]
        self.assertEqual([r["batch_id"] for r in rows], ["K"])
        self.assertTrue(rows[0]["complete"])
        self.assertEqual(rows[0]["time_per_question_sec"], 1.0)


if __name__ == "__main__":
    unittest.main()


class SteadinessTests(unittest.TestCase):
    """Separate runs of exactly the same setup pool like passes; any change starts a new setup."""

    def setUp(self) -> None:
        # The prompt actually sent lives beside each run on disk; here every run sent the same one
        patcher = mock.patch.object(lab, "_sent_prompt", lambda b: "same")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_three_one_pass_runs_pool_into_three_tries(self) -> None:
        cfg = config("c", prompt="p", model="claude-haiku-5-5")
        runs = [
            batch("R1", "c", "single-agent", [True, True, False, False], created="2026-11-20T10:00:00", configuration=cfg),
            batch("R2", "c", "single-agent", [True, False, False, True], created="2026-11-21T10:00:00", configuration=cfg),
            batch("R3", "c", "single-agent", [True, True, False, True], created="2026-11-22T10:00:00", configuration=cfg),
        ]
        s = lab.steadiness(runs, "R3")
        self.assertEqual([r["batch_id"] for r in s["runs"]], ["R1", "R2", "R3"])
        self.assertEqual(s["questions"], 4)
        self.assertEqual(s["tries_per_question"], {"min": 3, "max": 3})
        self.assertEqual((s["always_right"], s["sometimes"], s["never_right"]), (1, 2, 1))
        # pass^3: q0 1, q1 0 (2 of 3), q2 0, q3 0 -> 0.25
        self.assertAlmostEqual(s["pass_hat_3"], 0.25)
        self.assertEqual({m["task_id"]: (m["right"], m["tries"]) for m in s["mixed"]}, {"q1": (2, 3), "q3": (2, 3)})

    def test_a_changed_setup_does_not_pool(self) -> None:
        old = config("c", prompt="p", model="claude-haiku-5-5")
        new = config("c", prompt="p, but shorter", model="claude-haiku-5-5")
        r1 = batch("R1", "c", "single-agent", [True, False], created="2026-11-20T10:00:00", configuration=old)
        r2 = batch("R2", "c", "single-agent", [False, True], created="2026-11-21T10:00:00", configuration=new)
        s = lab.steadiness([r1, r2], "R2")
        self.assertEqual([r["batch_id"] for r in s["runs"]], ["R2"])
        self.assertEqual(s["questions"], 0)  # one try each: nothing to say yet
        self.assertFalse(lab.diff(r1, r2)["same_config"])

    def test_a_changed_sent_prompt_does_not_pool(self) -> None:
        cfg = config("c", prompt="p", model="claude-haiku-5-5")
        r1 = batch("R1", "c", "single-agent", [True, False], created="2026-11-20T10:00:00", configuration=cfg)
        r2 = batch("R2", "c", "single-agent", [False, True], created="2026-11-21T10:00:00", configuration=cfg)
        with mock.patch.object(lab, "_sent_prompt", lambda b: b.id):
            self.assertEqual(lab.steadiness([r1, r2], "R2")["questions"], 0)
            d = lab.diff(r1, r2)
        self.assertFalse(d["same_config"])
        self.assertEqual(d["changes"][0]["what"], "System prompt sent")

    def test_flaky_problem_counts_separate_runs(self) -> None:
        cfg = config("c", prompt="p", model="claude-haiku-5-5")
        r1 = batch("R1", "c", "single-agent", [True, True, False], created="2026-11-20T10:00:00", configuration=cfg)
        r2 = batch("R2", "c", "single-agent", [True, False, False], created="2026-11-21T10:00:00", configuration=cfg)
        with mock.patch.object(overview, "hidden", return_value=set()):
            flaky = [p for p in lab.problems([r2, r1])["problems"] if p["kind"] == "flaky"]
        self.assertEqual(len(flaky), 1)
        self.assertIn("1 Financial calculation question across 2 runs", flaky[0]["title"])
        self.assertEqual((flaky[0]["batch_id"], flaky[0]["other_batch_id"]), ("R2", "R1"))

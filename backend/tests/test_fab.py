import json
import unittest
from unittest import mock

from app.benchmarks import fab_grading, fab_tools
from app.datasets import registry
from app.llm import LLMResult

RUBRIC = [
    {"id": 0, "criterion": "Revenue is $4.0B", "severity": 3.0, "must_pass": True},
    {"id": 1, "criterion": "Margin is 20%", "severity": 2.0, "must_pass": False},
    {"id": 2, "criterion": "Cites the 10-K", "severity": 1.0, "must_pass": False},
]


def verdicts(*passes: bool, hedged: bool = False) -> str:
    return json.dumps({"criteria": [{"id": i, "pass": p, "reason": "r"} for i, p in enumerate(passes)], "hedged": hedged})


class ScoringTests(unittest.TestCase):
    def test_partial_credit_is_severity_weighted(self) -> None:
        s = fab_grading.score(RUBRIC, {0: True, 1: False, 2: True})
        self.assertAlmostEqual(s["partial_credit"], 4 / 6)
        self.assertFalse(s["all_pass"])

    def test_failed_must_pass_is_zero(self) -> None:
        s = fab_grading.score(RUBRIC, {0: False, 1: True, 2: True})
        self.assertEqual(s["partial_credit"], 0.0)
        self.assertTrue(s["dealbreaker_failed"])

    def test_all_pass(self) -> None:
        s = fab_grading.score(RUBRIC, {0: True, 1: True, 2: True})
        self.assertEqual((s["partial_credit"], s["all_pass"]), (1.0, True))


class JudgeOutputTests(unittest.TestCase):
    def test_parses_json_in_prose(self) -> None:
        parsed = fab_grading.parse_verdicts("Here you go:\n" + verdicts(True, False, True, hedged=True), [0, 1, 2])
        self.assertEqual(parsed[0][1], (False, "r"))
        self.assertTrue(parsed[1])

    def test_missing_criterion_is_unusable(self) -> None:
        self.assertIsNone(fab_grading.parse_verdicts(verdicts(True, True), [0, 1, 2]))


class JuryTests(unittest.TestCase):
    def run_jury(self, replies: list[str], judges: list[str]) -> dict:
        settings = {"fab_judge_models": judges}
        calls = iter(LLMResult(text=t, cost_usd=0.001) for t in replies)
        with mock.patch.object(fab_grading, "settings", return_value=settings), \
             mock.patch.object(fab_grading, "complete", side_effect=lambda **_: next(calls)):
            return fab_grading.grade("q", "a", RUBRIC)

    def test_majority_vote_per_criterion(self) -> None:
        ev = self.run_jury([verdicts(True, True, False), verdicts(True, False, False), verdicts(True, True, True)],
                           ["a", "b", "c"])
        self.assertEqual([c["passed"] for c in ev["criteria"]], [True, True, False])
        self.assertAlmostEqual(ev["partial_credit"], 5 / 6)
        self.assertEqual(len(ev["criteria"][1]["votes"]), 3)  # every judge's verdict is kept
        self.assertFalse(ev["official"])

    def test_tie_fails_and_unusable_judge_is_dropped_after_retry(self) -> None:
        ev = self.run_jury([verdicts(True, True, True), "not json", "still not", verdicts(True, False, True)],
                           ["a", "b", "c"])
        self.assertEqual(ev["failed_judges"], ["b"])
        self.assertEqual([c["passed"] for c in ev["criteria"]], [True, False, True])  # 1-1 tie fails
        self.assertAlmostEqual(ev["grading_cost_usd"], 0.004)


class ToolTests(unittest.TestCase):
    def test_calculator_handles_powers_and_multi_argument_functions(self) -> None:
        from app.runners.tools import calculate
        self.assertEqual(calculate("(5048/4086)^(1/3)-1"), calculate("pow(5048/4086, 1/3) - 1"))
        self.assertAlmostEqual(float(calculate("(5048/4086)^(1/3)-1")), 0.07301796857)
        self.assertEqual(calculate("1,234,567 + 1"), "1234568")  # thousands separators still dropped
        self.assertEqual(calculate("max(3, 7)"), "7")
        self.assertTrue(calculate("2^1000").startswith("error"))

    def test_html_to_text_keeps_tables_and_drops_hidden_xbrl(self) -> None:
        html = "<html><head><title>x</title></head><body><ix:header>hidden</ix:header><p>Revenue</p>" \
               "<table><tr><td>2025</td><td>$4,000</td></tr></table><script>bad()</script></body></html>"
        text = fab_tools.html_to_text(html)
        self.assertIn("2025 | $4,000", text)
        self.assertNotIn("hidden", text)
        self.assertNotIn("bad()", text)

    def test_retrieve_needs_a_stored_key(self) -> None:
        box = fab_tools.FabToolbox()
        self.assertIn("no saved document", box.execute("retrieve_information", {"prompt": "From {{x}}, revenue?"}))

    def test_relevant_slice_keeps_matching_passages(self) -> None:
        text = ("filler " * 3000) + " operating margin was 21.4% " + ("filler " * 3000)
        cut = fab_tools._relevant_slice(text, "What was the operating margin?", 8_000)
        self.assertIn("21.4%", cut)
        self.assertLessEqual(len(cut), 8_100)


class DatasetTests(unittest.TestCase):
    def test_v21_tasks_carry_rubric_and_version(self) -> None:
        tasks = registry.list_tasks("fab", limit=100)
        if not tasks:
            self.skipTest("FAB v2.1 not downloaded")
        self.assertEqual(len(tasks), 27)
        self.assertEqual(sum(len(t.metadata["rubric"]) for t in tasks), 239)
        t = tasks[0]
        self.assertEqual(t.metadata["fab_version"], "2.1")
        self.assertTrue(t.id.startswith("fab21-"))
        self.assertIsNone(t.expected_answer)


if __name__ == "__main__":
    unittest.main()

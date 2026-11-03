import unittest

from app.datasets.registry import (
    _finqa_task,
    final_answer_span,
    humanize_expected,
    score_answer,
    split_reasoning_and_answer,
)


class FinQATaskTests(unittest.TestCase):
    def test_context_keeps_evidence_at_end_of_post_text(self) -> None:
        item = {
            "id": "example",
            "pre_text": [],
            "table": [],
            "post_text": ["irrelevant " * 300, "values were 153.7 and 139.9"],
            "qa": {"question": "What was the change?", "exe_ans": "0.09864"},
        }

        task = _finqa_task(item, 0)

        self.assertIn("153.7 and 139.9", task.context)

    def test_markdown_bold_final_answer_is_scored(self) -> None:
        text = "**Reasoning:** 5829 - 5735 = 94\n\n**Final answer:** $94 million"
        self.assertEqual(final_answer_span(text), "$94 million")
        self.assertTrue(score_answer("94.0", text))

    def test_final_answer_span_ignores_scratch_work(self) -> None:
        text = (
            "2005 was 92.7 and 2006 was 100.7 so change looks like 8.\n"
            "Final answer: 94"
        )
        self.assertEqual(final_answer_span(text), "94")

    def test_split_reasoning_and_answer(self) -> None:
        reasoning, final = split_reasoning_and_answer(
            "Reasoning: 5829 - 5735 = 94 in millions.\nFinal answer: $94 million"
        )
        self.assertEqual(reasoning, "5829 - 5735 = 94 in millions.")
        self.assertEqual(final, "$94 million")


    def test_score_accepts_equivalent_quantities(self) -> None:
        # FinQA exe_ans is program/table units; $94 million is the same quantity.
        self.assertTrue(score_answer("94.0", "94"))
        self.assertTrue(score_answer("94.0", "$94 million"))
        self.assertTrue(score_answer("94.0", "94000000"))
        self.assertTrue(
            score_answer(
                "94.0",
                "Net revenue rose.\nAnswer: $94 million",
            )
        )

    def test_score_accepts_equivalent_percentage(self) -> None:
        self.assertTrue(score_answer("0.09864", "9.864%"))
        self.assertTrue(score_answer("0.14464", "14.5%"))
        self.assertTrue(score_answer("0.14464", "0.14464"))

    def test_humanize_expected_adds_clear_units_only(self) -> None:
        self.assertEqual(
            humanize_expected("94.0", answer_text="94", unit_scale="million"),
            "$94 million",
        )
        self.assertEqual(
            humanize_expected("0.14464", answer_text="14%", unit_scale="million"),
            "14%",
        )
        # No invented units when evidence is missing
        self.assertEqual(humanize_expected("94.0", answer_text="94"), "94")

    def test_score_rejects_wrong_or_janky_answers(self) -> None:
        self.assertFalse(score_answer("94.0", "$93 million"))
        self.assertFalse(score_answer("94.0", "940 million"))
        # Unknown unit — do not treat as a bare 94 pass
        self.assertFalse(score_answer("94.0", "94 potatoes"))
        # Do not mine a matching number out of reasoning when the final line is wrong
        self.assertFalse(
            score_answer(
                "94.0",
                "The table shows a change of 94 in millions.\n10.66%",
            )
        )
        self.assertFalse(score_answer("0.06757", "10.66%"))


if __name__ == "__main__":
    unittest.main()

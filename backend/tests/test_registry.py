import unittest

from app.datasets.registry import (
    _finqa_task,
    final_answer_span,
    humanize_expected,
    parse_final_quantity,
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

    def test_finqa_task_keeps_expected_model_input_for_post_run_audit(self) -> None:
        task = _finqa_task(
            {
                "id": "example",
                "pre_text": [],
                "table": [],
                "post_text": [],
                "qa": {
                    "question": "What changed?",
                    "exe_ans": "1",
                    "model_input": [["text_1", "Investments began at $100."]],
                },
            },
            0,
        )

        self.assertEqual(
            task.metadata["expected_evidence"],
            ["Investments began at $100."],
        )

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

    def test_percentage_scoring_respects_display_precision(self) -> None:
        self.assertTrue(
            score_answer("0.14464", "14%", expected_is_percent=True)
        )
        self.assertTrue(
            score_answer("0.14464", "14.5%", expected_is_percent=True)
        )
        self.assertTrue(
            score_answer("0.14464", "14.464%", expected_is_percent=True)
        )
        self.assertTrue(
            score_answer("0.14464", "0.14464", expected_is_percent=True)
        )
        self.assertFalse(
            score_answer("0.14464", "15%", expected_is_percent=True)
        )

    def test_percentage_not_accepted_for_non_percentage_answer(self) -> None:
        self.assertFalse(
            score_answer("6.76", "6.76%", expected_is_percent=False)
        )

    def test_signs_and_numeric_threshold(self) -> None:
        self.assertTrue(
            score_answer("-0.06757", "−6.76%", expected_is_percent=True)
        )
        self.assertTrue(score_answer("100", "+100.9"))
        self.assertTrue(score_answer("-100", "(100.9)"))
        self.assertFalse(score_answer("100", "101.1"))
        self.assertFalse(score_answer("-100", "100"))
        parsed = parse_final_quantity("(94)")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.value if parsed else None, -94)

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

    def test_finqa_step_percentage_becomes_human_expected_display(self) -> None:
        task = _finqa_task(
            {
                "id": "percentage",
                "pre_text": [],
                "table": [],
                "post_text": [],
                "qa": {
                    "question": "What percentage?",
                    "answer": "",
                    "exe_ans": "1.1197",
                    "steps": [{"op": "minus", "res": "111.97%"}],
                },
            },
            0,
        )
        self.assertTrue(task.metadata["expected_is_percent"])
        self.assertEqual(task.expected_display, "111.97%")

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

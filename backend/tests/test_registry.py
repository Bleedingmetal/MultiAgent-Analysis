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

    def test_markdown_bold_final_answer_is_scored(self) -> None:
        text = "**Reasoning:** 5829 - 5735 = 94\n\n**Final answer:** $94 million"
        self.assertEqual(final_answer_span(text), "$94 million")
        self.assertTrue(score_answer("94.0", text))

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

    def test_percentage_rounding_slip_within_tolerance_passes(self) -> None:
        # FinQA 0.09302 = 9.302%; 9.31% is a last-digit rounding slip, not a wrong answer
        self.assertTrue(
            score_answer("0.09302", "9.31%", expected_is_percent=True)
        )
        self.assertFalse(
            score_answer("0.09302", "9.5%", expected_is_percent=True)
        )

    def test_percent_unit_programs_compare_as_percentages(self) -> None:
        # Program multiplied by const_100: gold -26.06635 already means -26.07%
        self.assertTrue(
            score_answer("-26.06635", "-26.1%", expected_is_percent=True, expected_in_percent_units=True)
        )
        self.assertTrue(
            score_answer("2.5", "2.5", expected_is_percent=True, expected_in_percent_units=True)
        )
        self.assertFalse(
            score_answer("-26.06635", "-2606.6%", expected_is_percent=True, expected_in_percent_units=True)
        )

    def test_self_contradicting_label_accepts_annotation_and_is_flagged(self) -> None:
        from app.runners.execute import score_task_output

        task = _finqa_task(
            {
                "id": "disputed",
                "pre_text": [],
                "table": [],
                "post_text": [],
                "qa": {
                    "question": "by what percent did net cash increase?",
                    "answer": "",
                    "exe_ans": -1047.5,
                    "program": "subtract(1410.5, 1229.0), subtract(#0, 1229.0)",
                    "steps": [{"op": "minus", "res": ".1477"}],
                },
            },
            0,
        )
        self.assertEqual(task.metadata["alternate_answers"], [".1477"])
        scored = score_task_output(task, "Final answer: 14.77%")
        self.assertTrue(scored.success)
        self.assertTrue(scored.label_disputed)
        self.assertFalse(score_task_output(task, "Final answer: 20%").success)

    def test_written_answer_contradicting_program_is_accepted(self) -> None:
        from app.runners.execute import score_task_output

        # FinQA: "sales growth rate" with a gold program missing its divide
        task = _finqa_task(
            {
                "id": "growth",
                "pre_text": [],
                "table": [],
                "post_text": [],
                "qa": {
                    "question": "what is the sales growth rate from 2017 to 2018?",
                    "answer": "1.70%",
                    "exe_ans": 284.5,
                    "program": "subtract(17057.4, 16772.9)",
                    "steps": [{"op": "minus", "res": "284.5"}],
                },
            },
            0,
        )
        self.assertEqual(task.metadata["alternate_answers"], ["1.70%"])
        self.assertTrue(score_task_output(task, "Final answer: 1.70%").success)
        self.assertTrue(score_task_output(task, "Final answer: 284.5").success)
        self.assertFalse(score_task_output(task, "Final answer: 2.5%").success)

    def test_consistent_label_is_not_disputed(self) -> None:
        task = _finqa_task(
            {
                "id": "clean",
                "pre_text": [],
                "table": [],
                "post_text": [],
                "qa": {
                    "question": "what percentage?",
                    "answer": "14%",
                    "exe_ans": 0.14464,
                    "program": "divide(8.1, 56.0)",
                    "steps": [{"op": "divide", "res": "14%"}],
                },
            },
            0,
        )
        self.assertEqual(task.metadata["alternate_answers"], [])

    def test_percent_form_accepted_when_gold_has_no_percent_sign(self) -> None:
        # FinQA LMT/2014/page_91.pdf-4: a ratio of 0.15413 answered as 15.41%
        self.assertTrue(score_answer("0.15413", "Final answer: 15.41%", expected_is_percent=False))
        # FinQA VNO/2014/page_57.pdf-2: a change of 105 index points answered as 105%
        self.assertTrue(score_answer("105.0", "Final answer: 105%", expected_is_percent=False))
        self.assertTrue(score_answer("6.76", "6.76%", expected_is_percent=False))

    def test_number_formatting_does_not_change_the_score(self) -> None:
        # FinQA EOG/2018/page_75.pdf-1: gold 338928 (thousands)
        gold = "338928.0"
        for said in [
            "338,928 thousand",
            "338928 thousand",
            "338,928 (thousand)",
            "338,928 (in thousands)",
            "$338,928 (thousands)",
            "$338,928 (in $ thousands)",
            "338 928 thousand",
            "approximately $338,928 thousand",
            "$338,928 thousand (≈ $338.9 million)",
        ]:
            with self.subTest(said=said):
                self.assertTrue(score_answer(gold, f"Final answer: {said}", expected_is_percent=False))

    def test_formatting_tidy_does_not_rescue_wrong_answers(self) -> None:
        self.assertFalse(score_answer("338928.0", "Final answer: $412,000 thousand", expected_is_percent=False))
        self.assertFalse(score_answer("338928.0", "Final answer: 338,928 potatoes", expected_is_percent=False))
        self.assertTrue(score_answer("-100", "(100.9)"))
        self.assertFalse(score_answer("100", "(100.9)"))

    def test_percent_form_still_needs_the_right_number(self) -> None:
        self.assertFalse(score_answer("0.15413", "Final answer: 18.2%", expected_is_percent=False))
        self.assertFalse(score_answer("105.0", "Final answer: 1.2%", expected_is_percent=False))

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

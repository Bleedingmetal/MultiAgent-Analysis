import unittest

from app.datasets.registry import _finqa_task, score_answer


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

    def test_score_accepts_number_with_currency_and_units(self) -> None:
        self.assertTrue(score_answer("94.0", "$94 million"))

    def test_score_accepts_equivalent_percentage(self) -> None:
        self.assertTrue(score_answer("0.09864", "The change was 9.9%."))

    def test_score_rejects_wrong_number(self) -> None:
        self.assertFalse(score_answer("94.0", "$93 million"))


if __name__ == "__main__":
    unittest.main()

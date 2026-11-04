import unittest

from app.datasets.finqa_program import (
    execute_program,
    extract_program,
    normalize_program,
    operation_sequence,
    strip_program_from_reasoning,
)


class FinQAProgramTests(unittest.TestCase):
    def test_executes_multi_step_program_with_constants_and_references(self) -> None:
        program = (
            "subtract(318.46, const_100), divide(#0, const_100), "
            "subtract(206.49, const_100), divide(#2, const_100), "
            "subtract(#1, #3)"
        )

        execution = execute_program(program)

        self.assertIsNone(execution.error)
        self.assertAlmostEqual(float(execution.result), 1.1197, places=4)

    def test_executes_table_aggregation(self) -> None:
        execution = execute_program(
            "table_average(revenue, none)",
            table=[["", "2022", "2023"], ["revenue", "$100", "$120"]],
        )

        self.assertEqual(execution.result, 110)

    def test_extracts_and_normalizes_agent_program(self) -> None:
        output = (
            "Reasoning: compare the two values.\n"
            "Program: subtract(5829, 5735)\n"
            "Final answer: 94"
        )

        self.assertEqual(extract_program(output), "subtract(5829, 5735)")
        self.assertEqual(
            normalize_program(" subtract(5829, 5735) "),
            "subtract(5829,5735)",
        )
        self.assertEqual(
            operation_sequence("subtract(3, 2), divide(#0, const_100)"),
            ["subtract", "divide"],
        )

    def test_removes_program_from_display_reasoning(self) -> None:
        reasoning = (
            "The table provides both values.\n"
            "Program: subtract(5829, 5735)"
        )
        self.assertEqual(
            strip_program_from_reasoning(reasoning),
            "The table provides both values.",
        )

    def test_reports_invalid_program(self) -> None:
        execution = execute_program("subtract(1)")
        self.assertIsNone(execution.result)
        self.assertIn("two arguments", execution.error or "")


if __name__ == "__main__":
    unittest.main()

import unittest

from app import metrics
from app.schemas import RunResult, TraceStep


def finqa_run(task: str, answer: str, success: bool | None, run_id: str = "r") -> RunResult:
    return RunResult(
        id=run_id, mode="pipeline", benchmark_id="finqa", task_id=task, configuration_id="c1",
        configuration_name="Single", architecture="single-agent", model="claude-haiku-5-5",
        question="q", answer=answer, success=success, latency_sec=1.0, prompt_tokens=1,
        completion_tokens=1, cost_usd=0.0, created_at="2026-11-19T00:00:00Z", system_prompt="sys",
    )


def tau_run(task: str, changes: list[dict], calls: list[tuple[str, dict]], success: bool = True) -> RunResult:
    step = TraceStep(index=0, node_id="n", node_name="agent", node_type="model", kind="agent",
                     tool_calls=[{"name": n, "arguments": a} for n, a in calls])
    run = finqa_run(task, "done", success)
    return run.model_copy(update={"benchmark_id": "tau2-retail", "db_changes": changes, "steps": [step]})


class PassHatKTests(unittest.TestCase):
    def test_formula(self) -> None:
        # C(2,2)/C(3,2) = 1/3; C(3,3)/C(3,3) = 1; any failure among exactly k attempts gives 0
        self.assertAlmostEqual(metrics.pass_hat_k(2, 3, 2), 1 / 3)
        self.assertEqual(metrics.pass_hat_k(3, 3, 3), 1.0)
        self.assertEqual(metrics.pass_hat_k(2, 3, 3), 0.0)
        self.assertAlmostEqual(metrics.pass_hat_k(4, 5, 3), 4 / 10)

    def test_fewer_attempts_than_k_is_not_available(self) -> None:
        self.assertIsNone(metrics.pass_hat_k(2, 2, 3))

    def test_tasks_count_once_whatever_their_attempts(self) -> None:
        runs = [finqa_run("a", "Final answer: 1", True)] * 6 + [finqa_run("b", "Final answer: 1", s) for s in (True, False, False)]
        group = metrics.group_runs(runs)[0]
        # task a: 1.0, task b: C(1,3)/C(3,3) = 0 -> mean 0.5, not weighted 6:3
        self.assertEqual(metrics.reliability(group, 3), {"k": 3, "value": 0.5, "eligible_tasks": 2})


class OutputConsistencyTests(unittest.TestCase):
    def test_equivalent_finqa_answers_agree(self) -> None:
        runs = [finqa_run("t", "Final answer: 6.49%", True), finqa_run("t", "Final answer: 0.0649", True)]
        self.assertEqual(metrics.output_consistency(runs), 1.0)

    def test_agreement_is_about_the_answer_not_pass_fail(self) -> None:
        # both wrong but identical: fully consistent; one right and one wrong refusal: not
        same_wrong = [finqa_run("t", "Final answer: 12", False), finqa_run("t", "Final answer: 12.0", False)]
        self.assertEqual(metrics.output_consistency(same_wrong), 1.0)
        mixed = [finqa_run("t", "Final answer: 12", True), finqa_run("t", "Final answer: Not determinable", False)]
        self.assertEqual(metrics.output_consistency(mixed), 0.0)

    def test_pairwise_mean(self) -> None:
        runs = [finqa_run("t", f"Final answer: {x}", None) for x in ("5", "5", "9")]
        self.assertAlmostEqual(metrics.output_consistency(runs), 1 / 3)  # 1 of 3 pairs agree

    def test_tau_compares_the_end_state(self) -> None:
        change = [{"path": "orders.#W1.status", "change": "changed", "from": "pending", "to": "cancelled"}]
        a = tau_run("t", change, [("get_order_details", {"order_id": "#W1"})])
        b = tau_run("t", change, [("find_user", {"name": "x"}), ("cancel_order", {"order_id": "#W1"})])
        c = tau_run("t", [], [])
        self.assertEqual(metrics.output_consistency([a, b]), 1.0)
        self.assertEqual(metrics.output_consistency([a, c]), 0.0)

    def test_one_run_is_not_available(self) -> None:
        self.assertIsNone(metrics.output_consistency([finqa_run("t", "Final answer: 5", True)]))


class ExecutionConsistencyTests(unittest.TestCase):
    def test_sequence_similarity_is_normalised_levenshtein(self) -> None:
        a = [("find_user", frozenset()), ("get_order", frozenset()), ("cancel", frozenset())]
        b = [("find_user", frozenset()), ("cancel", frozenset())]
        self.assertAlmostEqual(metrics.sequence_similarity(a, b), 1 - 1 / 3)

    def test_argument_jaccard_is_step_aligned(self) -> None:
        a = [("cancel", frozenset({("id", "1"), ("reason", "x")}))]
        b = [("cancel", frozenset({("id", "1"), ("reason", "y")}))]
        self.assertAlmostEqual(metrics.argument_similarity(a, b), 1 / 3)
        c = [("refund", frozenset({("id", "1")}))]
        self.assertEqual(metrics.argument_similarity(a, c), 0.0)

    def test_finqa_paths_ignore_nesting_and_percent_step(self) -> None:
        nested = finqa_run("t", "Program: multiply(divide(465, 7170), const_100)\nFinal answer: 6.49%", True)
        flat = finqa_run("t", "Program: divide(465, 7170)\nFinal answer: 0.0649", True)
        self.assertEqual(metrics.execution_consistency([nested, flat]), 1.0)

    def test_no_paths_means_not_available(self) -> None:
        runs = [finqa_run("t", "Final answer: 5", True), finqa_run("t", "Final answer: 5", True)]
        self.assertIsNone(metrics.execution_consistency(runs))


class CombinedTests(unittest.TestCase):
    def test_weights_and_missing_execution(self) -> None:
        change = [{"path": "orders.#W1.status", "change": "changed", "to": "cancelled"}]
        runs = [tau_run("t", change, [("cancel", {"id": "1"})]), tau_run("t", [], [("cancel", {"id": "2"})])]
        group = metrics.group_runs(runs)[0]
        c = metrics.consistency(group)
        self.assertEqual(c["output"], 0.0)
        self.assertAlmostEqual(c["execution"], 0.5)  # same tool (1.0), args share nothing (0.0)
        self.assertAlmostEqual(c["combined"], 0.7 * 0.0 + 0.3 * 0.5)
        only_output = metrics.consistency(metrics.group_runs([finqa_run("t", "Final answer: 5", True)] * 2)[0])
        self.assertEqual(only_output["output"], 1.0)
        self.assertIsNone(only_output["execution"])
        self.assertIsNone(only_output["combined"])

    def test_different_conditions_are_not_pooled(self) -> None:
        a = finqa_run("t", "Final answer: 5", True)
        b = a.model_copy(update={"system_prompt": "a different prompt"})
        self.assertEqual(len(metrics.group_runs([a, b])), 2)


if __name__ == "__main__":
    unittest.main()

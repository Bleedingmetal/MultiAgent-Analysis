import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from app import batches, spend_guard
from app.datasets import registry
from app.schemas import AgentConfiguration, BatchRequest, RunResult

CONFIG = AgentConfiguration.model_validate(
    {
        "id": "cfg-1",
        "name": "Test config",
        "architecture": "single-agent",
        "layers": [{"id": "agents", "name": "Agents", "type": "agents", "order": 0}],
        "nodes": [
            {
                "id": "a1",
                "name": "Agent",
                "type": "model",
                "layerId": "agents",
                "order": 0,
                "modelSettings": {"provider": "openai", "model": "gpt-4o-mini"},
            }
        ],
    }
)


def fake_execute(outcomes):
    """Return a stand-in for dispatch.execute; outcomes maps task index -> pass/fail/error/raise."""
    tasks = registry.sample_tasks("finqa", None)
    position = {t.id: i for i, t in enumerate(tasks)}

    def run(config, task, *, mode, meter, model_override=None, parent_run_id=None):
        outcome = outcomes(position[task.id])
        meter.add_cost(0.01)
        if outcome == "raise":
            raise RuntimeError("provider exploded")
        return RunResult(
            id=f"RUN-{task.id}",
            mode=mode,
            benchmark_id="finqa",
            task_id=task.id,
            configuration_id=config.id,
            configuration_name=config.name,
            architecture=config.architecture,
            model="gpt-4o-mini",
            question=task.question,
            answer="Final answer: 1",
            scored_answer="1",
            success={"pass": True, "fail": False}.get(outcome),
            status="incomplete" if outcome == "error" else "completed",
            error="step failed" if outcome == "error" else None,
            latency_sec=0.5,
            prompt_tokens=100,
            completion_tokens=10,
            cost_usd=0.01,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    return run


def wait(batch_id, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        batch = batches.get(batch_id)
        if batch and batch.status != "running":
            return batch
        time.sleep(0.02)
    raise AssertionError("batch did not finish")


class BatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        patches = [
            mock.patch.object(batches, "BATCHES_DIR", Path(self.tmp.name)),
            mock.patch.object(batches, "_batches", {}),
            mock.patch.object(batches, "_run_index", {}),
            mock.patch.object(batches, "_cancel", {}),
            mock.patch.object(batches, "_loaded", True),
            mock.patch.object(spend_guard, "_state", spend_guard.SpendState()),
            mock.patch.dict(spend_guard.settings(), {"daily_budget_usd": 100.0}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def start(self, outcomes, **kwargs):
        with mock.patch.object(batches, "execute", fake_execute(outcomes)):
            batch = batches.start(BatchRequest(configuration=CONFIG, **kwargs))
            return wait(batch.id)

    def test_summary_counts_rates_and_costs(self) -> None:
        pattern = ["pass", "pass", "fail", "error", "raise"]
        batch = self.start(lambda i: pattern[i % 5], size=10, concurrency=3)
        s = batch.summary
        self.assertEqual(batch.status, "completed")
        self.assertEqual((s.total, s.done, s.passed, s.failed, s.errors), (10, 10, 4, 2, 4))
        self.assertAlmostEqual(s.pass_rate, 4 / 6)  # errors are not hidden in the rate
        self.assertAlmostEqual(s.cost_usd, 0.10)
        self.assertAlmostEqual(s.cost_per_pass_usd, 0.025)
        self.assertEqual(s.prompt_tokens, 800)  # 8 runs returned results
        self.assertAlmostEqual(spend_guard._state.spend_usd, 0.10)
        self.assertEqual(spend_guard._state.run_count, 1)  # one batch = one run

    def test_items_follow_the_fixed_sample(self) -> None:
        batch = self.start(lambda i: "pass", size=5)
        self.assertEqual(
            [i.task_id for i in batch.items],
            [t.id for t in registry.sample_tasks("finqa", 5)],
        )

    def test_spend_cap_stops_and_skips_the_rest(self) -> None:
        batch = self.start(lambda i: "pass", size=20, budget_usd=0.03, concurrency=1)
        self.assertEqual(batch.status, "stopped")
        self.assertIn("spend cap", batch.stop_reason)
        self.assertEqual(batch.summary.done, 3)
        self.assertEqual(batch.summary.skipped, 17)

    def test_cancel(self) -> None:
        gate = threading.Event()

        def slow(i):
            gate.wait(5)
            return "pass"

        with mock.patch.object(batches, "execute", fake_execute(slow)):
            batch = batches.start(BatchRequest(configuration=CONFIG, size=10, concurrency=1))
            batches.cancel(batch.id)
            gate.set()
            batch = wait(batch.id)
        self.assertEqual(batch.status, "cancelled")
        self.assertLessEqual(batch.summary.done, 1)

    def test_only_one_batch_at_a_time(self) -> None:
        gate = threading.Event()
        with mock.patch.object(batches, "execute", fake_execute(lambda i: gate.wait(5) and "pass")):
            first = batches.start(BatchRequest(configuration=CONFIG, size=2, concurrency=1))
            with self.assertRaises(RuntimeError):
                batches.start(BatchRequest(configuration=CONFIG, size=2))
            gate.set()
            wait(first.id)

    def test_question_runs_are_retrievable_and_listing_is_light(self) -> None:
        batch = self.start(lambda i: "pass", size=3)
        run_id = batch.items[0].run_id
        self.assertEqual(batches.get_run(run_id).id, run_id)
        listed = batches.list_batches("cfg-1")
        self.assertEqual([b.id for b in listed], [batch.id])
        self.assertEqual(listed[0].items, [])

    def test_restart_marks_running_batch_interrupted(self) -> None:
        batch = self.start(lambda i: "pass", size=2)
        stale = batch.model_copy(update={"status": "running"})
        stale.items[1].status = "pending"
        batches._save(stale)
        with mock.patch.object(batches, "_batches", {}), mock.patch.object(batches, "_loaded", False):
            reloaded = batches.get(batch.id)
        self.assertEqual(reloaded.status, "interrupted")
        self.assertEqual(reloaded.items[1].status, "skipped")


if __name__ == "__main__":
    unittest.main()

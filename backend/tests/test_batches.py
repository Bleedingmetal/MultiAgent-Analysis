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
            # spend persists to disk now; keep the tests' spend out of the real file
            mock.patch.object(spend_guard, "SPEND_FILE", Path(self.tmp.name) / "spend.json"),
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

    def test_pauses_before_overspending_and_continues_on_request(self) -> None:
        # 10 questions at $0.01 each against a $0.05 cap: after 3 results the projection
        # ($0.10) is over the cap, so the run pauses before spending past it.
        with mock.patch.object(batches, "execute", fake_execute(lambda i: "pass")):
            batch = batches.start(BatchRequest(configuration=CONFIG, size=10, budget_usd=0.05, concurrency=1))
            paused = wait(batch.id)
            self.assertEqual(paused.status, "paused")
            self.assertEqual(paused.summary.done, 3)
            self.assertIn("go over budget", paused.stop_reason)
            self.assertIn("$0.10", paused.stop_reason)
            self.assertAlmostEqual(paused.summary.cost_usd, 0.03)
            self.assertEqual(paused.summary.projected_cost_usd, 0.1)
            # Continue: the cap rises to double the projection and the run finishes
            resumed = batches.resume(batch.id)
            self.assertEqual(resumed.status, "running")
            self.assertTrue(resumed.budget_ack)
            self.assertAlmostEqual(resumed.budget_usd, 0.20)
            done = wait(batch.id)
        self.assertEqual(done.status, "completed")
        self.assertEqual(done.summary.done, 10)
        self.assertAlmostEqual(done.summary.cost_usd, 0.10)

    def test_continuing_a_cheap_run_raises_the_cap_enough(self) -> None:
        # Haiku-sized numbers: a $0.001 cap must not round the raised cap down to $0
        def cheap(config, task, *, mode, meter, model_override=None, parent_run_id=None):
            meter.add_cost(0.0003)
            r = fake_execute(lambda i: "pass")(config, task, mode=mode, meter=spend_guard.RunMeter())
            return r.model_copy(update={"cost_usd": 0.0003})

        with mock.patch.object(batches, "execute", cheap):
            batch = batches.start(BatchRequest(configuration=CONFIG, size=10, budget_usd=0.001, concurrency=1))
            self.assertEqual(wait(batch.id).status, "paused")
            resumed = batches.resume(batch.id)
            self.assertGreater(resumed.budget_usd, 0.003)
            done = wait(batch.id)
        self.assertEqual((done.status, done.summary.done), ("completed", 10))

    def test_stopping_a_paused_run_closes_it(self) -> None:
        with mock.patch.object(batches, "execute", fake_execute(lambda i: "pass")):
            batch = batches.start(BatchRequest(configuration=CONFIG, size=10, budget_usd=0.05, concurrency=1))
            self.assertEqual(wait(batch.id).status, "paused")
            stopped = batches.cancel(batch.id)
        self.assertEqual(stopped.status, "cancelled")
        self.assertEqual(stopped.summary.skipped, 7)
        with self.assertRaises(RuntimeError):
            batches.resume(batch.id)

    def test_runs_within_budget_never_pause(self) -> None:
        batch = self.start(lambda i: "pass", size=10, budget_usd=1.0, concurrency=2)
        self.assertEqual(batch.status, "completed")
        self.assertFalse(batch.budget_ack)

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
        stale.items[1].attempts = []
        batches._save(stale)
        with mock.patch.object(batches, "_batches", {}), mock.patch.object(batches, "_loaded", False):
            reloaded = batches.get(batch.id)
        self.assertEqual(reloaded.status, "interrupted")
        self.assertEqual(reloaded.items[1].status, "skipped")


class MultiPassTests(BatchTests):
    def test_each_question_runs_every_pass(self) -> None:
        batch = self.start(lambda i: "pass", size=4, passes=3, concurrency=2)
        self.assertEqual(batch.status, "completed")
        self.assertTrue(all(len(i.attempts) == 3 for i in batch.items))
        self.assertEqual([a.pass_index for a in batch.items[0].attempts], [0, 1, 2])
        s = batch.summary
        self.assertEqual((s.passes, s.attempts_total, s.attempts_done, s.passed), (3, 12, 12, 12))
        self.assertEqual((s.total, s.done), (4, 4))
        self.assertAlmostEqual(s.cost_usd, 0.12)  # 12 answers at $0.01
        self.assertAlmostEqual(batch.items[0].cost_usd, 0.03)  # summed over passes

    def test_disagreeing_passes_make_a_mixed_question(self) -> None:
        calls = {}

        def outcome(i):
            # question 0 alternates pass/fail across its passes; question 1 always passes
            n = calls.get(i, 0)
            calls[i] = n + 1
            return ("pass" if n % 2 == 0 else "fail") if i == 0 else "pass"

        batch = self.start(outcome, size=2, passes=4, concurrency=1)
        q0, q1 = batch.items
        self.assertEqual(q0.status, "mixed")
        self.assertEqual((q0.passes_passed, q0.passes_failed), (2, 2))
        self.assertEqual(q1.status, "passed")
        s = batch.summary
        self.assertAlmostEqual(s.pass_rate, 6 / 8)  # mean over answers
        self.assertAlmostEqual(s.pass_all_rate, 1 / 2)  # q1 only
        self.assertAlmostEqual(s.pass_any_rate, 1.0)
        self.assertEqual(s.mixed, 1)

    def test_passes_run_the_whole_set_then_again(self) -> None:
        order: list[tuple[int, int]] = []
        tasks = registry.sample_tasks("finqa", 3)
        pos = {t.id: i for i, t in enumerate(tasks)}
        base = fake_execute(lambda i: "pass")

        def recording(config, task, *, mode, meter, model_override=None, parent_run_id=None):
            order.append((pos[task.id], len([o for o in order if o[0] == pos[task.id]])))
            return base(config, task, mode=mode, meter=meter)

        with mock.patch.object(batches, "execute", recording):
            batch = batches.start(BatchRequest(configuration=CONFIG, size=3, passes=2, concurrency=1))
            wait(batch.id)
        # all three questions once, then all three again
        self.assertEqual([q for q, _ in order], [0, 1, 2, 0, 1, 2])

    def test_spend_cap_stops_between_full_passes(self) -> None:
        batch = self.start(lambda i: "pass", size=3, passes=2, budget_usd=0.03, concurrency=1)
        self.assertEqual(batch.status, "stopped")
        self.assertEqual(batch.summary.attempts_done, 3)
        # the first full pass finished for every question; the second never started
        self.assertEqual([len(i.attempts) for i in batch.items], [1, 1, 1])
        self.assertEqual([i.status for i in batch.items], ["passed", "passed", "passed"])
        per = batch.summary.per_pass
        self.assertEqual([(x.pass_index, x.done) for x in per], [(0, 3), (1, 0)])
        self.assertEqual(batch.summary.pass_rate_min, 1.0)

    def test_per_pass_summaries_show_the_spread(self) -> None:
        calls = {}

        def outcome(i):
            # every question fails on its second pass only
            n = calls.get(i, 0)
            calls[i] = n + 1
            return "pass" if n == 0 else "fail"

        batch = self.start(outcome, size=4, passes=2, concurrency=1)
        per = batch.summary.per_pass
        self.assertEqual([x.pass_rate for x in per], [1.0, 0.0])
        self.assertEqual((batch.summary.pass_rate_min, batch.summary.pass_rate_max), (0.0, 1.0))
        self.assertAlmostEqual(batch.summary.pass_rate, 0.5)
        self.assertAlmostEqual(per[0].cost_usd, 0.04)

    def test_errored_pass_is_recorded_as_an_attempt(self) -> None:
        pattern = ["pass", "raise"]
        batch = self.start(lambda i: pattern[i % 2], size=2, passes=2)
        self.assertEqual(batch.items[1].status, "error")
        self.assertEqual([a.status for a in batch.items[1].attempts], ["error", "error"])
        self.assertEqual(batch.summary.errors, 1)
        # the errored passes still spent money
        self.assertAlmostEqual(batch.items[1].cost_usd, 0.02)


if __name__ == "__main__":
    unittest.main()

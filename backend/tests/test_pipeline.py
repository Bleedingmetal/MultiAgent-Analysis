import json
import unittest
from unittest import mock

from app.datasets.registry import Task
from app.llm import LLMResult
from app.runners import pipeline
from app.runners.tools import build_toolset, calculate, search_context
from app.schemas import AgentConfiguration
from app.spend_guard import RunMeter

TASK = Task(
    id="t1",
    benchmark_id="finqa",
    question="What was the change?",
    expected_answer="94",
    context="Table:\nrevenue | 5829 | 5735\ncosts | 100 | 90",
    metadata={},
)


def layer(id_, type_, order):
    return {"id": id_, "name": id_, "type": type_, "order": order}


def node(id_, type_, layer_id, order=0, provider=None, model=None, **meta):
    n = {"id": id_, "name": id_, "type": type_, "layerId": layer_id, "order": order, "metadata": meta}
    if provider:
        n["modelSettings"] = {"provider": provider, "model": model, "temperature": 0.5}
    return n


def config(arch, layers, nodes):
    return AgentConfiguration.model_validate(
        {"id": arch, "name": arch, "architecture": arch, "layers": layers, "nodes": nodes, "edges": []}
    )


IO = [node("prompt", "input", "input"), node("final-answer", "output", "output")]


def gpt(id_, layer_id, order=0, **meta):
    return node(id_, "model", layer_id, order, "openai", "gpt-4o-mini", **meta)


TEMPLATES = {
    "single-agent": config(
        "single-agent",
        [layer("input", "input", 0), layer("agents", "agents", 1), layer("output", "output", 2)],
        IO + [gpt("agent-1", "agents")],
    ),
    "prompt-chaining": config(
        "prompt-chaining",
        [layer("input", "input", 0), layer("agents", "agents", 1), layer("output", "output", 2)],
        IO + [gpt("chain-1", "agents", 0), gpt("chain-2", "agents", 1), gpt("chain-3", "agents", 2)],
    ),
    "routing": config(
        "routing",
        [layer("input", "input", 0), layer("orch", "orchestration", 1), layer("agents", "agents", 2), layer("output", "output", 3)],
        IO + [
            node("router", "router", "orch"),
            gpt("route-a", "agents", 0),
            node("route-b", "model", "agents", 1, "anthropic", "claude-sonnet-5-5"),
        ],
    ),
    "parallelization": config(
        "parallelization",
        [layer("input", "input", 0), layer("orch", "orchestration", 1), layer("agents", "agents", 2),
         layer("agg", "aggregation", 3), layer("output", "output", 4)],
        IO + [
            node("controller", "parallel-controller", "orch"),
            gpt("parallel-1", "agents", 0),
            node("parallel-2", "model", "agents", 1, "anthropic", "claude-sonnet-5-5"),
            node("aggregator", "aggregator", "agg"),
        ],
    ),
    "evaluator-optimizer": config(
        "evaluator-optimizer",
        [layer("input", "input", 0), layer("agents", "agents", 1), layer("output", "output", 2)],
        IO + [gpt("generator", "agents", 0), node("evaluator", "evaluator", "agents", 1)],
    ),
    "autonomous-agent": config(
        "autonomous-agent",
        [layer("input", "input", 0), layer("agents", "agents", 1), layer("tools", "tools", 2), layer("output", "output", 3)],
        IO + [
            gpt("autonomous-agent", "agents"),
            node("tool-1", "tool", "tools", 0, tool="calculator"),
            node("tool-2", "tool", "tools", 1, tool="context_search"),
        ],
    ),
    "custom": config(
        "custom",
        [layer("input", "input", 0), layer("orch", "orchestration", 1), layer("agents", "agents", 2), layer("output", "output", 3)],
        IO + [node("router", "router", "orch"), gpt("agent-1", "agents")],
    ),
}


class FakeLLM:
    """Scripted stand-in for app.llm.complete; records every call."""

    def __init__(self, evaluator_verdicts=("revise", "accept"), agent_answers=None):
        self.calls = []
        self.verdicts = list(evaluator_verdicts)
        self.agent_answers = agent_answers or {}

    def __call__(self, *, provider, model, system, user, tools=None, before_call=None, **_):
        if before_call:
            before_call()
        self.calls.append({"provider": provider, "model": model, "system": system, "user": user, "tools": tools})
        if system.endswith(pipeline.ROUTER_SYSTEM):
            text = json.dumps({"route": "route-b", "reason": "claude fits"})
        elif system.endswith(pipeline.CONTROLLER_SYSTEM):
            text = json.dumps({
                "strategy": "split",
                "rationale": "two parts",
                "assignments": [
                    {"worker": "parallel-1", "subtask": "find revenue"},
                    {"worker": "parallel-2", "subtask": "find costs"},
                ],
            })
        elif system.endswith(pipeline.EVALUATOR_SYSTEM):
            verdict = self.verdicts.pop(0) if self.verdicts else "accept"
            text = json.dumps({"verdict": verdict, "feedback": "check units" if verdict == "revise" else ""})
        else:
            answer = "94"
            for key, value in self.agent_answers.items():
                if key in user:
                    answer = value
            text = f"Reasoning: 5829-5735\nFinal answer: {answer}"
        return LLMResult(text=text, prompt_tokens=100, completion_tokens=20, cost_usd=0.001)


def run(arch, fake=None, **kwargs):
    return run_config(TEMPLATES[arch], fake, **kwargs)


def run_config(cfg, fake=None, **kwargs):
    fake = fake or FakeLLM()
    with mock.patch.object(pipeline, "complete", fake),             mock.patch.object(pipeline, "require_provider", lambda *_: None):
        result = pipeline.run_pipeline(cfg, TASK, meter=RunMeter(), **kwargs)
    return result, fake


class PipelineTemplateTests(unittest.TestCase):
    def test_single_agent_is_one_call_with_answer_format(self):
        result, fake = run("single-agent")
        self.assertEqual(len(fake.calls), 1)
        self.assertIn("Final answer:", fake.calls[0]["user"])
        self.assertTrue(result.success)
        self.assertEqual(result.mode, "pipeline")

    def test_prompt_chain_passes_output_forward_and_only_last_is_final(self):
        result, fake = run("prompt-chaining")
        self.assertEqual([s.node_id for s in result.steps], ["chain-1", "chain-2", "chain-3"])
        self.assertIn(pipeline.INTERMEDIATE_NOTE, fake.calls[0]["user"])
        self.assertIn("### chain-1", fake.calls[1]["user"])
        self.assertIn("### chain-2", fake.calls[2]["user"])
        self.assertIn("Reply in this format", fake.calls[2]["user"])
        self.assertTrue(result.success)

    def test_routing_runs_only_the_chosen_agent_on_its_provider(self):
        result, fake = run("routing")
        self.assertEqual([s.kind for s in result.steps], ["router", "agent"])
        self.assertEqual(result.steps[1].node_id, "route-b")
        self.assertEqual(fake.calls[1]["provider"], "anthropic")
        # Router has no settings: inherits first agent's model
        self.assertEqual(fake.calls[0]["model"], "gpt-4o-mini")

    def test_parallel_splits_subtasks_then_aggregates(self):
        result, fake = run("parallelization")
        kinds = [s.kind for s in result.steps]
        self.assertEqual(kinds[0], "controller")
        self.assertEqual(sorted(kinds[1:3]), ["agent", "agent"])
        self.assertEqual(kinds[3], "aggregator")
        worker_users = [c["user"] for c in fake.calls[1:3]]
        self.assertTrue(any("find revenue" in u for u in worker_users))
        self.assertTrue(any("find costs" in u for u in worker_users))
        self.assertIn("### parallel-1", fake.calls[3]["user"])
        self.assertTrue(result.success)

    def test_evaluator_sends_feedback_back_to_generator(self):
        result, fake = run("evaluator-optimizer")
        self.assertEqual(
            [(s.kind, s.round) for s in result.steps],
            [("agent", 1), ("evaluator", 1), ("agent", 2), ("evaluator", 2)],
        )
        self.assertIn("check units", fake.calls[2]["user"])
        self.assertEqual(result.steps[3].decision["verdict"], "accept")
        # Evaluator must never see the gold answer
        self.assertNotIn("expected", fake.calls[1]["user"].lower())

    def test_evaluator_stops_at_max_rounds(self):
        fake = FakeLLM(evaluator_verdicts=["revise"] * 10)
        result, _ = run("evaluator-optimizer", fake)
        evals = [s for s in result.steps if s.kind == "evaluator"]
        self.assertEqual(len(evals), 3)
        self.assertIn("note", evals[-1].decision)

    def test_autonomous_agent_gets_both_tools(self):
        result, fake = run("autonomous-agent")
        names = [t.name for t in fake.calls[0]["tools"]]
        self.assertEqual(names, ["calculator", "context_search"])

    def test_custom_router_with_one_agent_skips_the_call(self):
        result, fake = run("custom")
        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(result.steps[0].kind, "router")
        self.assertEqual(result.steps[0].cost_usd, 0)

    def test_model_override_applies_to_every_llm_node(self):
        result, fake = run("routing", model_override="claude-haiku-4-5")
        self.assertTrue(all(c["model"] == "claude-haiku-4-5" for c in fake.calls))
        self.assertTrue(all(c["provider"] == "anthropic" for c in fake.calls))

    def test_routing_without_aggregator_votes(self):
        cfg = TEMPLATES["routing"].model_copy(deep=True)
        controller = cfg.nodes[2].model_copy(update={"type": "parallel-controller", "id": "ctl"})
        cfg.nodes[2] = controller
        result, _ = run_config(cfg)
        self.assertEqual(result.steps[-1].kind, "vote")
        self.assertTrue(result.success)

    def test_cost_and_tokens_are_summed(self):
        result, _ = run("prompt-chaining")
        self.assertAlmostEqual(result.cost_usd, 0.003)
        self.assertEqual(result.prompt_tokens, 300)
        self.assertEqual(result.llm_calls, 3)

    def test_missing_provider_key_fails_before_any_call(self):
        fake = FakeLLM()
        missing = {"openai": True, "anthropic": False, "google": False}
        with mock.patch.object(pipeline, "complete", fake),                 mock.patch("app.llm.provider_configured", lambda p: missing.get(p, False)):
            with self.assertRaisesRegex(RuntimeError, "route-b.*ANTHROPIC_API_KEY"):
                pipeline.run_pipeline(TEMPLATES["routing"], TASK, meter=RunMeter())
        self.assertEqual(fake.calls, [])

    def test_call_cap_stops_run(self):
        with mock.patch.dict(pipeline.settings(), {"max_llm_calls_per_run": 2}):
            with self.assertRaises(RuntimeError):
                run("prompt-chaining")


class ToolTests(unittest.TestCase):
    def test_calculator(self):
        self.assertEqual(calculate("(5829 - 5735) / 5735 * 100"), "1.639058413")
        self.assertEqual(calculate("1,000 + 5"), "1005")
        self.assertTrue(calculate("__import__('os')").startswith("error"))
        self.assertTrue(calculate("1/0").startswith("error"))

    def test_context_search(self):
        self.assertIn("5829", search_context(TASK.context, "revenue"))

    def test_toolset_dedupes(self):
        specs, execute = build_toolset(["calculator", "calculator"], TASK)
        self.assertEqual(len(specs), 1)
        self.assertEqual(execute("calculator", {"expression": "2+2"}), "4")
        self.assertTrue(execute("context_search", {"query": "x"}).startswith("error"))


if __name__ == "__main__":
    unittest.main()

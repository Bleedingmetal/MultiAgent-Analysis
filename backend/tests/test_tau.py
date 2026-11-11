"""τ-bench / τ²-bench adapters, without any network: the model and the simulated
customer are scripted, the benchmark packages' environments and graders are real."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("TAU2_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))

from app import spend_guard  # noqa: E402
from app.benchmarks import conversation as conv  # noqa: E402
from app.benchmarks.conversation import ConversationAgent, db_changes  # noqa: E402
from app.llm_turn import TurnResult, TurnToolCall  # noqa: E402
from app.schemas import AgentConfiguration  # noqa: E402

TOOLS = [{"type": "function", "function": {"name": "get_order", "description": "", "parameters": {"type": "object"}}}]


def config(architecture="single-agent", nodes=None):
    nodes = nodes or [{"id": "a", "name": "Agent", "type": "model", "layerId": "L", "order": 0,
                       "modelSettings": {"provider": "openai", "model": "gpt-4o-mini", "temperature": 0}}]
    return AgentConfiguration.model_validate({
        "id": "cfg", "name": "Test", "architecture": architecture,
        "layers": [{"id": "L", "name": "Agents"}], "nodes": nodes, "edges": [],
    })


class ScriptedModel:
    """Replaces chat_turn: pops the next scripted TurnResult, remembers what it was asked."""

    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []

    def __call__(self, **kw):
        self.calls.append(kw)
        if not self.turns:
            return TurnResult(text="Anything else?", prompt_tokens=1, completion_tokens=1, cost_usd=0.0001)
        return self.turns.pop(0)


def text(t):
    return TurnResult(text=t, prompt_tokens=10, completion_tokens=5, cost_usd=0.001)


def call(name, **args):
    return TurnResult(text="", tool_calls=[TurnToolCall(id=f"call_{name}", name=name, arguments=args)],
                      prompt_tokens=10, completion_tokens=5, cost_usd=0.001)


class ConversationAgentTests(unittest.TestCase):
    def test_single_agent_turn_records_tool_calls_and_results(self):
        model = ScriptedModel([call("get_order", order_id="#W1"), text("Your order is on its way.")])
        with mock.patch.object(conv, "chat_turn", model):
            agent = ConversationAgent(config(), "policy", mode="single-agent", meter=spend_guard.RunMeter())
            wire = [{"role": "user", "content": "Where is my order?"}]
            reply = agent.respond(wire, TOOLS)
            self.assertEqual([c.name for c in reply.tool_calls], ["get_order"])
            self.assertEqual(reply.text, "")
            agent.tool_result("call_get_order", '{"status": "shipped"}')
            wire += [{"role": "assistant", "content": "", "tool_calls": [{"id": "call_get_order", "name": "get_order", "arguments": {"order_id": "#W1"}}]},
                     {"role": "tool", "tool_call_id": "call_get_order", "content": '{"status": "shipped"}'}]
            reply = agent.respond(wire, TOOLS)
        self.assertEqual(reply.text, "Your order is on its way.")
        steps = agent.trace.steps
        self.assertEqual(len(steps), 2)
        self.assertEqual(steps[0].tool_calls[0]["result"], '{"status": "shipped"}')
        self.assertTrue(steps[0].tool_calls[0]["executed"])
        self.assertIn("<policy>", steps[0].system_prompt)
        self.assertEqual(model.calls[0]["tools"], TOOLS)
        self.assertAlmostEqual(agent.trace.cost_usd, 0.002)

    def test_routing_picks_a_specialist_once(self):
        nodes = [
            {"id": "r", "name": "Router", "type": "router", "layerId": "L", "order": 0,
             "modelSettings": {"provider": "openai", "model": "gpt-4o-mini"}},
            {"id": "a", "name": "Orders", "type": "model", "layerId": "L", "order": 1,
             "modelSettings": {"provider": "openai", "model": "gpt-4o-mini"}, "promptStep": {"role": "orders"}},
            {"id": "b", "name": "Returns", "type": "model", "layerId": "L", "order": 2,
             "modelSettings": {"provider": "openai", "model": "gpt-4o-mini"}, "promptStep": {"role": "returns"}},
        ]
        model = ScriptedModel([text('{"route": "b", "reason": "a return"}'), text("Let me help with that return."), text("Done.")])
        with mock.patch.object(conv, "chat_turn", model):
            agent = ConversationAgent(config("routing", nodes), "policy", mode="routing", meter=spend_guard.RunMeter())
            wire = [{"role": "user", "content": "I want to return a watch"}]
            r1 = agent.respond(wire, TOOLS)
            wire += [{"role": "assistant", "content": r1.text}, {"role": "user", "content": "thanks"}]
            agent.respond(wire, TOOLS)
        kinds = [(s.kind, s.node_id) for s in agent.trace.steps]
        self.assertEqual(kinds, [("router", "r"), ("agent", "b"), ("agent", "b")])
        self.assertEqual(agent.trace.steps[0].decision["route_name"], "Returns")
        self.assertEqual(len(model.calls), 3)

    def test_chain_lets_earlier_steps_note_and_the_last_speak(self):
        nodes = [
            {"id": "a", "name": "Researcher", "type": "model", "layerId": "L", "order": 0,
             "modelSettings": {"provider": "openai", "model": "gpt-4o-mini"}},
            {"id": "b", "name": "Responder", "type": "model", "layerId": "L", "order": 1,
             "modelSettings": {"provider": "openai", "model": "gpt-4o-mini"}},
        ]
        model = ScriptedModel([text("1. Verify identity first."), text("Could you share your zip code?")])
        with mock.patch.object(conv, "chat_turn", model):
            agent = ConversationAgent(config("prompt-chaining", nodes), "policy", mode="prompt-chain", meter=spend_guard.RunMeter())
            reply = agent.respond([{"role": "user", "content": "Cancel my order"}], TOOLS)
        self.assertEqual(reply.text, "Could you share your zip code?")
        self.assertEqual([s.node_id for s in agent.trace.steps], ["a", "b"])
        self.assertTrue(agent.trace.steps[0].decision["private_notes"])
        self.assertIn("Verify identity first", model.calls[1]["system"])
        self.assertEqual(model.calls[1]["tools"], TOOLS)


class DbChangesTests(unittest.TestCase):
    def test_lists_changed_added_and_removed_values(self):
        before = {"orders": {"#W1": {"status": "pending", "items": [1]}}}
        after = {"orders": {"#W1": {"status": "cancelled", "items": [1], "cancel_reason": "no longer needed"}}}
        changes = {c["path"]: c for c in db_changes(before, after)}
        self.assertEqual(changes["orders.#W1.status"]["to"], "cancelled")
        self.assertEqual(changes["orders.#W1.cancel_reason"], {"path": "orders.#W1.cancel_reason", "change": "added", "value": "no longer needed"})


class FakeCustomer:
    """Stands in for tau-bench's LLM customer: opening line, one confirmation, then stop."""

    def __init__(self, *a, **k):
        self.n = 0

    def reset(self, instruction=None):
        return "Hi, I'm Fatima Johnson, zip 78712. Cancel all my pending orders and return my watch, and tell me the total I get back."

    def step(self, content):
        self.n += 1
        return "Yes, please do all of that." if self.n == 1 else "###STOP###"

    def get_total_cost(self):
        return 0.0005


class TauBenchV1Tests(unittest.TestCase):
    """Runs the real tau_bench retail environment with a scripted agent that follows the gold actions."""

    @classmethod
    def setUpClass(cls):
        try:
            import tau_bench  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("tau_bench not installed")

    def _run(self, script):
        from app.benchmarks import tau_retail
        from app.datasets import registry

        task = registry.get_task("tau-retail", "tau-retail-016")
        model = ScriptedModel(script)
        with mock.patch.object(conv, "chat_turn", model), \
                mock.patch.object(tau_retail, "CostedUser", FakeCustomer), \
                mock.patch.object(tau_retail, "settings", lambda: {"tau_user_model": "gpt-4o-mini", "tau_max_steps": 30}):
            return tau_retail.run_task(config(), task, mode="single-agent", meter=spend_guard.RunMeter())

    def test_following_the_reference_actions_passes(self):
        from tau_bench.envs.retail.tasks_test import TASKS_TEST

        gold = [a for a in TASKS_TEST[16].actions if a.name != "respond"]
        script = [text("Let me check.")] + [call(a.name, **a.kwargs) for a in gold] + [text("All done. Total refund: $8276.23.")]
        result = self._run(script)
        self.assertTrue(result.success, result.note)
        self.assertEqual(result.benchmark_id, "tau-retail")
        self.assertEqual(result.evaluation["reward"], 1.0)
        self.assertTrue(result.evaluation["db_match"])
        self.assertEqual(result.evaluation["outputs"], {"8276.23": True})
        self.assertEqual(result.evaluation["termination_reason"], "user_stop")
        paths = {c["path"] for c in result.db_changes}
        self.assertIn("orders.#W5199551.status", paths)
        roles = [m["role"] for m in result.conversation]
        self.assertEqual(roles[0], "user")
        self.assertIn("tool", roles)
        self.assertGreater(result.cost_usd, 0)
        self.assertAlmostEqual(result.evaluation["user_simulator_cost_usd"], 0.0005)
        self.assertEqual(result.llm_calls, len(result.steps))

    def test_wrong_database_state_fails_with_the_reference_diff(self):
        script = [text("Let me check."), call("find_user_id_by_name_zip", first_name="Fatima", last_name="Johnson", zip="78712"),
                  call("cancel_pending_order", order_id="#W5199551", reason="no longer needed"), text("Cancelled one order, total $8276.23")]
        result = self._run(script)
        self.assertFalse(result.success)
        self.assertFalse(result.evaluation["db_match"])
        self.assertTrue(result.evaluation["expected_db_changes"])
        self.assertIn("orders.#W8665881.status", {c["path"] for c in result.evaluation["expected_db_changes"]})


class Tau2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (Path(os.environ["TAU2_DATA_DIR"]) / "tau2" / "domains" / "retail" / "tasks.json").exists():
            raise unittest.SkipTest("tau2 retail data not downloaded")
        try:
            import tau2  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("tau2 not installed")

    def test_tasks_hide_the_grading_and_keep_the_scenario(self):
        from app.datasets import registry

        task = registry.get_task("tau2-retail", "tau2-retail-16")
        self.assertIn("cancel all pending orders", task.question)
        self.assertIsNone(task.expected_answer)
        self.assertEqual(task.metadata["reward_basis"], ["DB", "NL_ASSERTION"])
        self.assertIn("cancel_pending_order", task.metadata["reference_tools"])
        self.assertEqual(registry.task_count("tau2-retail"), 114)
        self.assertEqual(len(registry.sample_tasks("tau2-retail", 5)), 5)

    def test_judge_replies_are_parsed_even_when_fenced_or_wrapped(self):
        from app.benchmarks.tau2_retail import lenient_json_loads

        want = {"results": [{"expectedOutcome": "x", "metExpectation": True, "reasoning": "r"}]}
        body = json.dumps(want)
        self.assertEqual(lenient_json_loads(body), want)
        self.assertEqual(lenient_json_loads("```json" + chr(10) + body + chr(10) + "```"), want)
        self.assertEqual(lenient_json_loads("Here is my evaluation:" + chr(10) + body + chr(10) + "Done."), want)
        with self.assertRaises(json.JSONDecodeError):
            lenient_json_loads("no json here")

    def test_config_agent_hands_tool_calls_back_to_the_orchestrator(self):
        from tau2.data_model.message import MultiToolMessage, ToolMessage, UserMessage
        from tau2.domains.retail.environment import get_environment

        from app.benchmarks.tau2_retail import ConfigAgent

        env = get_environment()
        model = ScriptedModel([call("get_order_details", order_id="#W1"), text("It shipped.")])
        with mock.patch.object(conv, "chat_turn", model):
            inner = ConversationAgent(config(), env.get_policy(), mode="single-agent", meter=spend_guard.RunMeter())
            agent = ConfigAgent(inner, env.get_tools(), env.get_policy())
            state = agent.get_init_state()
            msg, state = agent.generate_next_message(UserMessage(role="user", content="Where is #W1?"), state)
            self.assertIsNone(msg.content)
            self.assertEqual(msg.tool_calls[0].name, "get_order_details")
            tool_msg = MultiToolMessage(role="tool", tool_messages=[ToolMessage(id=msg.tool_calls[0].id, role="tool", content="shipped", requestor="assistant")])
            msg2, state = agent.generate_next_message(tool_msg, state)
        self.assertEqual(msg2.content, "It shipped.")
        self.assertEqual(inner.trace.steps[0].tool_calls[0]["result"], "shipped")
        self.assertTrue(any(t["function"]["name"] == "cancel_pending_order" for t in model.calls[0]["tools"]))


if __name__ == "__main__":
    unittest.main()

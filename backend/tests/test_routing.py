import unittest

from app.datasets.registry import Task
from app.runners.routing import (
    RoutingConfigError,
    parse_router_decision,
    pick_route,
    render_router_user,
    resolve_routing,
    run_routing,
)
from app.schemas import (
    AgentConfiguration,
    ConfigurationNode,
    ModelSettings,
    PromptStepSettings,
    RouterSettings,
)


def _task(**kwargs) -> Task:
    values = {
        "id": "task-1",
        "benchmark_id": "fab",
        "question": "What is 2 + 2?",
        "expected_answer": "4",
        "context": "A simple arithmetic task.",
        "metadata": {},
    }
    values.update(kwargs)
    return Task(**values)


def _route(
    node_id: str,
    order: int,
    *,
    route_id: str = "",
    role: str = "analyst",
    description: str = "Numeric tasks.",
) -> ConfigurationNode:
    return ConfigurationNode(
        id=node_id,
        name=node_id,
        type="model",
        layerId="agents",
        order=order,
        modelSettings=ModelSettings(provider="openai", model="gpt-4o-mini", temperature=0.2),
        promptStep=PromptStepSettings(
            role=role,
            objective=f"Objective for {node_id}",
            instructions="Do the work.",
            routeId=route_id or role,
            routeDescription=description,
        ),
    )


def _config(routes: list[ConfigurationNode], *, fallback: str = "") -> AgentConfiguration:
    return AgentConfiguration(
        id="cfg-routing",
        name="Routing",
        architecture="routing",
        layers=[
            {"id": "input", "name": "Input", "type": "input", "order": 0},
            {"id": "orch", "name": "Orchestration", "type": "orchestration", "order": 1},
            {"id": "agents", "name": "Agents", "type": "agents", "order": 2},
            {"id": "output", "name": "Output", "type": "output", "order": 3},
        ],
        nodes=[
            ConfigurationNode(
                id="prompt", name="Task input", type="input", layerId="input", order=0
            ),
            ConfigurationNode(
                id="router",
                name="Router",
                type="router",
                layerId="orch",
                order=0,
                modelSettings=ModelSettings(provider="openai", model="gpt-4o-mini"),
                routerSettings=RouterSettings(fallbackRouteId=fallback),
            ),
            *routes,
            ConfigurationNode(
                id="final", name="Final Answer", type="output", layerId="output", order=0
            ),
        ],
        edges=[],
    )


class RoutingTests(unittest.TestCase):
    def test_resolve_requires_one_router(self) -> None:
        cfg = _config([_route("a", 0)])
        cfg.nodes = [n for n in cfg.nodes if n.type != "router"]
        with self.assertRaises(RoutingConfigError):
            resolve_routing(cfg)

    def test_parse_router_decision(self) -> None:
        parsed, err = parse_router_decision(
            '{"selected_route":"analyst","explanation":"needs math"}'
        )
        self.assertIsNone(err)
        assert parsed
        self.assertEqual(parsed["selected_route"], "analyst")

    def test_invalid_route_uses_fallback(self) -> None:
        routes = [
            _route("r1", 0, route_id="researcher", role="researcher"),
            _route("r2", 1, route_id="analyst", role="analyst"),
        ]
        resolved = resolve_routing(_config(routes, fallback="researcher"))[1]
        picked, warnings, _ = pick_route(
            resolved,
            {"selected_route": "unknown", "explanation": "oops"},
            fallback_route_id="researcher",
        )
        self.assertIsNotNone(picked)
        assert picked
        self.assertEqual(picked.route_id, "researcher")
        self.assertIn("unknown", warnings)

    def test_only_selected_agent_executes(self) -> None:
        calls: list[str] = []

        def complete(*, user: str, **kwargs):
            calls.append(user)
            if len(calls) == 1:
                return (
                    '{"selected_route":"analyst","explanation":"calculation"}',
                    10,
                    5,
                )
            self.assertIn("Original task", user)
            self.assertNotIn("researcher", user.lower() or "")
            return ("Reasoning: add.\nFinal answer: 4", 12, 6)

        cfg = _config(
            [
                _route("researcher", 0, route_id="researcher", role="researcher"),
                _route("analyst", 1, route_id="analyst", role="analyst"),
            ]
        )
        result = run_routing(cfg, _task(), complete=complete)
        self.assertEqual(result.status, "completed")
        self.assertTrue(result.success)
        self.assertEqual(len(result.steps), 2)
        self.assertEqual(result.steps[0].step_kind, "router")
        self.assertEqual(result.steps[0].selected_route, "analyst")
        self.assertEqual(result.steps[1].step_kind, "agent")
        self.assertEqual(len(calls), 2)

    def test_router_failure_is_incomplete(self) -> None:
        def complete(**kwargs):
            raise RuntimeError("router down")

        result = run_routing(_config([_route("a", 0)]), _task(), complete=complete)
        self.assertEqual(result.status, "incomplete")
        self.assertEqual(result.steps[0].status, "error")
        self.assertIsNone(result.success)

    def test_render_router_user_lists_routes(self) -> None:
        _, routes = resolve_routing(
            _config([_route("a", 0, route_id="analyst", role="analyst")])
        )
        text = render_router_user(_task(), routes)
        self.assertIn("analyst", text)
        self.assertIn("Original task", text)


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest import mock

from app.datasets.registry import Task
from app.runners.prompt_chain import (
    ChainConfigError,
    StepOutput,
    parse_structured_output,
    render_system_prompt,
    resolve_chain,
    run_prompt_chain,
    select_inputs,
)
from app.schemas import (
    AgentConfiguration,
    ConfigurationNode,
    ModelSettings,
    PromptStepInputs,
    PromptStepSettings,
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


def _node(
    node_id: str,
    order: int,
    *,
    role: str = "custom",
    previous: str = "last",
    include_task: bool = True,
    output_format: str = "text",
    instructions: str = "Do the step.",
    model: str = "gpt-4o-mini",
    provider: str = "openai",
) -> ConfigurationNode:
    return ConfigurationNode(
        id=node_id,
        name=node_id,
        type="model",
        layerId="agents",
        order=order,
        modelSettings=ModelSettings(provider=provider, model=model, temperature=0.2),
        promptStep=PromptStepSettings(
            role=role,
            objective=f"Objective for {node_id}",
            instructions=instructions,
            promptTemplate="",
            inputs=PromptStepInputs(task=include_task, previousOutputs=previous),
            outputFormat=output_format,  # type: ignore[arg-type]
        ),
    )


def _config(nodes: list[ConfigurationNode]) -> AgentConfiguration:
    return AgentConfiguration(
        id="cfg-1",
        name="Chain",
        architecture="prompt-chaining",
        layers=[
            {"id": "input", "name": "Input", "type": "input", "order": 0},
            {"id": "agents", "name": "Agents", "type": "agents", "order": 1},
            {"id": "output", "name": "Output", "type": "output", "order": 2},
        ],
        nodes=[
            ConfigurationNode(
                id="prompt", name="Task input", type="input", layerId="input", order=0
            ),
            *nodes,
            ConfigurationNode(
                id="final", name="Final Answer", type="output", layerId="output", order=0
            ),
        ],
        edges=[],
    )


class PromptChainTests(unittest.TestCase):
    def test_resolve_chain_uses_node_order(self) -> None:
        config = _config([_node("b", 1), _node("a", 0)])
        steps = resolve_chain(config)
        self.assertEqual([step.node_id for step in steps], ["a", "b"])

    def test_legacy_nodes_without_prompt_step_still_resolve(self) -> None:
        node = ConfigurationNode(
            id="legacy",
            name="Legacy",
            type="model",
            layerId="agents",
            order=0,
            modelSettings=ModelSettings(provider="openai", model="gpt-4o-mini"),
            metadata={"instructions": "Use the table."},
        )
        steps = resolve_chain(_config([node]))
        self.assertEqual(steps[0].instructions, "Use the table.")
        self.assertEqual(steps[0].previous_outputs, "last")
        self.assertTrue(steps[0].include_task)

    def test_unsupported_provider_is_a_config_error(self) -> None:
        config = _config([_node("a", 0, provider="local", model="llama3.1")])
        with self.assertRaises(ChainConfigError):
            resolve_chain(config)

    def test_anthropic_steps_resolve(self) -> None:
        config = _config([_node("a", 0, provider="anthropic", model="claude-haiku-5-5")])
        steps = resolve_chain(config)
        self.assertEqual((steps[0].provider, steps[0].model), ("anthropic", "claude-haiku-5-5"))

    def test_missing_key_is_a_config_error_when_required(self) -> None:
        config = _config([_node("a", 0, provider="anthropic", model="claude-haiku-5-5")])
        with mock.patch("app.runners.prompt_chain.provider_configured", return_value=False):
            with self.assertRaises(ChainConfigError):
                resolve_chain(config, require_keys=True)

    def test_empty_chain_is_a_config_error(self) -> None:
        with self.assertRaises(ChainConfigError):
            resolve_chain(_config([]))

    def test_template_fills_role_and_appends_unused_sections(self) -> None:
        config = _config([_node("a", 0, role="researcher")])
        step = resolve_chain(config)[0]
        prompt, warnings = render_system_prompt(
            step, is_last=True, dataset_instructions="Final format."
        )
        self.assertIn("Researcher", prompt)
        self.assertIn("Objective for a", prompt)
        self.assertIn("Final format.", prompt)
        self.assertEqual(warnings, [])

    def test_select_inputs_last_and_all(self) -> None:
        config = _config(
            [
                _node("a", 0, previous="none"),
                _node("b", 1, previous="last"),
                _node("c", 2, previous="all"),
            ]
        )
        steps = resolve_chain(config)
        prior = [
            StepOutput(index=0, label="A", text="one"),
            StepOutput(index=1, label="B", text="two"),
        ]
        self.assertEqual(select_inputs(steps[0], prior), [])
        self.assertEqual([item.index for item in select_inputs(steps[1], prior)], [1])
        self.assertEqual([item.index for item in select_inputs(steps[2], prior)], [0, 1])

    def test_single_step_chain_scores_final_answer(self) -> None:
        def complete(**kwargs):
            return ("Reasoning: add two and two.\nFinal answer: 4", 12, 8)

        result = run_prompt_chain(
            _config([_node("a", 0)]),
            _task(),
            complete=complete,
        )
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.mode, "prompt-chain")
        self.assertTrue(result.success)
        self.assertEqual(result.scored_answer, "4")
        self.assertEqual(len(result.steps), 1)
        self.assertEqual(result.steps[0].status, "completed")
        self.assertIn("Original task", result.steps[0].user_prompt)

    def test_multi_step_handoff_and_trace(self) -> None:
        calls: list[str] = []

        def complete(*, user: str, **kwargs):
            calls.append(user)
            if len(calls) == 1:
                return ('{"summary":"found 2 and 2","facts":["2","2"],"calculations":[],"evidence":[],"answer":null}', 20, 10)
            self.assertIn("Output of step 1", user)
            self.assertIn("found 2 and 2", user)
            return ("Final answer: 4", 21, 6)

        result = run_prompt_chain(
            _config(
                [
                    _node("researcher", 0, role="researcher", output_format="structured"),
                    _node("analyst", 1, role="analyst", output_format="text"),
                ]
            ),
            _task(),
            complete=complete,
        )
        self.assertEqual(result.status, "completed")
        self.assertTrue(result.success)
        self.assertEqual(len(result.steps), 2)
        self.assertEqual(result.steps[0].structured_output["summary"], "found 2 and 2")
        self.assertEqual(result.steps[1].input_step_indexes, [0])
        self.assertEqual(result.prompt_tokens, 41)
        self.assertEqual(result.completion_tokens, 16)

    def test_failed_step_skips_remaining_and_keeps_trace(self) -> None:
        def complete(**kwargs):
            if not getattr(complete, "called", False):
                complete.called = True
                return ("first output", 5, 3)
            raise RuntimeError("provider down")

        result = run_prompt_chain(
            _config([_node("a", 0), _node("b", 1), _node("c", 2)]),
            _task(),
            complete=complete,
        )
        self.assertEqual(result.status, "incomplete")
        self.assertIsNone(result.success)
        self.assertEqual([step.status for step in result.steps], ["completed", "error", "skipped"])
        self.assertIn("provider down", result.error or "")
        self.assertTrue(result.steps[1].system_prompt)
        self.assertTrue(result.steps[2].warnings)

    def test_invalid_structured_output_still_passes_raw_text(self) -> None:
        def complete(*, user: str, **kwargs):
            if "Original task" in user and "Output of step" not in user:
                return ("not json", 4, 4)
            self.assertIn("not json", user)
            return ("Final answer: 4", 4, 4)

        result = run_prompt_chain(
            _config(
                [
                    _node("a", 0, output_format="structured"),
                    _node("b", 1),
                ]
            ),
            _task(),
            complete=complete,
        )
        self.assertEqual(result.steps[0].status, "invalid_output")
        self.assertEqual(result.status, "completed")
        self.assertTrue(result.success)

    def test_parse_structured_output(self) -> None:
        parsed, problem = parse_structured_output(
            '```json\n{"summary":"ok","facts":["a"],"calculations":[],"evidence":[],"answer":"1"}\n```'
        )
        self.assertIsNone(problem)
        self.assertEqual(parsed["answer"], "1")
        _, bad = parse_structured_output("hello")
        self.assertEqual(bad, "Response is not valid JSON.")


if __name__ == "__main__":
    unittest.main()

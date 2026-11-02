# Prompt Chaining

Prompt chaining is a sequential multi-agent architecture in the evaluation
platform. Users configure an ordered list of agents in the existing
configuration builder. The backend runs those agents one after another and
stores a per-step execution trace on the parent run.

## Why this design

- The builder already represents architectures as layers, nodes, and edges.
  Chain order is the `order` field on model nodes, not a separate graph engine.
- Dataset-specific scoring already lives in `score_task_output`. Chaining
  reuses it on the **final** step only, so FinQA/FAB/τ-bench stay independent
  of the architecture.
- Roles are labels plus editable default templates. They do not hardcode
  financial behavior. Users can change objective, instructions, template, and
  inputs without changing execution code.

## Configuration

Each model node on a `prompt-chaining` configuration may include `promptStep`:

- `role`: `researcher`, `analyst`, `verifier`, or `custom`
- `objective` / `instructions`: editable text
- `promptTemplate`: Mustache-style `{{role}}`, `{{objective}}`,
  `{{instructions}}`, `{{output_requirements}}`, `{{dataset_instructions}}`
- `inputs.task`: include the original benchmark task
- `inputs.previousOutputs`: `none`, `last`, or `all`
- `outputFormat`: `text` or `structured` (JSON envelope for intermediate steps)

Saved configurations without `promptStep` still run. The backend reconstructs
a custom step from `metadata.instructions` / `modelSettings.systemPrompt`.

Default chain template: Researcher → Analyst → Verifier.

## Execution

`POST /api/runs` with `mode: "prompt-chain"` (the UI sends this automatically
when the saved architecture is `prompt-chaining`):

1. Resolve model nodes in layer/order.
2. For each step, render the system prompt from its template and the user
   prompt from selected inputs.
3. Call the existing OpenAI client with that step's model and temperature.
4. Intermediate structured steps are parsed into
   `{summary, facts, calculations, evidence, answer}`. Invalid JSON is a
   warning; raw text is still passed forward.
5. The last step always produces text so existing scorers can read
   `Final answer:`.
6. If a step errors, later steps are recorded as `skipped` and the run status
   is `incomplete`. Earlier cost/traces are kept.

Single-agent mode is unchanged.

## Traces

Each step is a `ChainStepTrace` on `RunResult.steps`: identity, role, model,
prompts actually sent, raw/structured response, tokens, cost, latency, status,
and errors. The configuration run panel and run-detail page render this list.

Generated explanations are treated as inspectable artifacts, not hidden
chain-of-thought.

## Limitations

- Only OpenAI is executable today. Other providers can be selected in the UI
  but the backend rejects them before the run starts.
- Chains are capped at `MAX_CHAIN_STEPS` (default 6).
- Routing and parallelization are not implemented.
- Structured output is a JSON convention, not a provider-enforced schema.

# Routing architecture

Routing sends each task through an LLM **Router** that picks exactly one
specialist agent. Only that agent runs and produces the scored final answer.

Flow: **Input → Router → selected specialist → Output**

## Design (research-informed, not reproduced)

Inspired by modular multi-agent patterns (MasRouter, Anthropic “Building
Effective Agents”, DSPy-style declarative prompts):

- **Specialization**: each route is a model node with its own role, objective,
  model, and prompt template (same `promptStep` model as prompt chaining).
- **Structured routing decision**: the Router returns JSON
  `{ "selected_route", "explanation" }` so choices are observable, not hidden
  reasoning.
- **Cost-aware execution**: Router tokens and latency are included in run totals;
  non-selected agents are not executed.

## Configuration

- Architecture: `routing`
- One `router` node (`modelSettings` + `routerSettings`)
- One or more specialist `model` nodes with `promptStep`:
  - `routeId` — id the Router must return
  - `routeDescription` — when to select this route
  - `role`, `objective`, `instructions`, `promptTemplate` (shared with chains)
- Edges are rebuilt in the builder: input→router, router→each route, each
  route→output

Default template: Researcher, Analyst, Verifier (OpenAI).

## Execution

`POST /api/runs` with `mode: "routing"`:

1. Resolve router + routes; validate OpenAI providers and unique route ids.
2. Render router prompts from the task + route catalog (no benchmark gold).
3. Parse and validate `selected_route`; apply optional `fallbackRouteId`.
4. Run **only** the chosen specialist with dataset format instructions on that
   step (same scoring path as single-agent / chain final step).
5. On router or specialist failure → `status: incomplete`, traces preserved.

## Traces

`RunResult.steps` (reuses `ChainStepTrace`):

| Step | `step_kind` | Contents |
|------|-------------|----------|
| 0 | `router` | Prompts, JSON response, `selected_route`, `routing_explanation`, `available_routes` |
| 1 | `agent` | Specialist prompts, response, tokens, cost |

Shown in the configuration run panel and run detail via `ChainTraceView`.

## Limitations

- OpenAI execution only (same as prompt chaining today).
- At most `MAX_ROUTES` / `max_chain_steps` specialists (default 6).
- No parallel routes, orchestrator loops, or multi-hop routing.
- Router JSON is prompt-enforced, not a provider JSON schema.

## Reuse from prompt chaining

- `PromptStepSettings`, role defaults, template rendering (`render_system_prompt`,
  `task_user_prompt`, `score_task_output`)
- Builder properties panel patterns, pipeline layout, localStorage configs
- `ChainStepTrace` storage and UI

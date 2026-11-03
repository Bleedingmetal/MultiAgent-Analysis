# Agent Evaluation API

## Setup

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# put OPENAI_API_KEY and ANTHROPIC_API_KEY in .env (GOOGLE_API_KEY optional)
```

## Run

```bash
cd backend
.\.venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

Health: http://localhost:8000/api/health

## Datasets on disk

| Benchmark | Path | Notes |
|-----------|------|--------|
| FinQA | `data/finqa/test.json` (+ `sample20.json`) | Full public test set |
| τ-bench retail | `data/tau_bench/retail_sample.json` | 15 sample instructions |
| FAB | `data/fab/public.csv` (+ `sample20.json`) | vals-ai public validation |

Download all datasets from the repository root:

```bash
make datasets
```

The canonical downloader is `backend/scripts/download_datasets.py`. Run it
directly to use `--force` or `--only finqa|fab|tau`.

## Modes

- `pipeline` (default) — runs the builder configuration through the generic engine in
  `app/runners/pipeline.py`. Single-agent configs are a one-node chain, so baselines and
  multi-agent runs share one code path. Every LLM call is recorded in `steps` (trace).
- `classify-plan` — classifier suggests multi-agent roles (no workers)

`single-agent` from older clients is accepted and runs as `pipeline`.

## How configurations execute

Layers run in order; node **types** decide behavior (edges are visual only):

| Node / layer | Behavior |
|---|---|
| Agents layer, no orchestrator | Sequential chain; each agent sees the previous agent's output |
| Router before an agents layer | LLM picks one agent (by name / role / instructions) |
| Parallel Controller before an agents layer | LLM splits the task into per-worker subtasks or replicates it; workers run concurrently |
| Evaluator | Reviews the candidate before it; sends feedback back to its producer, up to `maxRounds` (default `MAX_EVAL_ROUNDS`) |
| Tool nodes (any layer) | Give every agent tools: `calculator`, `context_search` |
| Aggregator | LLM merges all incoming outputs |
| Several outputs reach Output | Free majority vote on final answers |

Each node uses its own provider/model/system prompt/instructions. Control nodes
(router, controller, evaluator, aggregator) without settings inherit the first agent's
model. Nodes with no system prompt use the dataset prompt. Only the node(s) whose output
is the answer get the dataset's `Final answer:` format.

Missing provider keys fail the run before any call. Per-run caps:
`MAX_LLM_CALLS_PER_RUN`, `MAX_RUN_COST_USD`, `MAX_TOOL_STEPS`; the daily budget is checked
before every call. Prices live in `app/pricing.py`.

## Tests

```bash
cd backend
.venv\Scripts\python -m unittest discover -s tests
```

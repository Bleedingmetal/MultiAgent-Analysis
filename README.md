# MultiAgent Analysis

Compares single-agent and multi-agent LLM configurations on finance benchmarks
(FinQA, τ-bench retail, τ²-bench retail, FAB): accuracy, cost, latency, audit trail.

## Setup (fresh clone)

You need Node 18+, Git, and Python 3.12+ (or [uv](https://docs.astral.sh/uv/),
which installs 3.12 for you). Then, from the repository root:

```bash
npm install
npm run setup
```

`npm run setup` creates `backend/.venv`, installs the Python requirements
(including the official `tau_bench` and `tau2` benchmark packages from GitHub),
creates `backend/.env` from the example, installs the frontend, and downloads
the benchmark data into `backend/data/` (it is not committed).

Put your keys in `backend/.env`:

```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

## Run

```bash
npm run dev
```

Backend on http://localhost:8000, frontend on http://localhost:3000. The backend
also checks for missing benchmark data every time it starts and downloads what is
absent, so a clone that skipped `npm run setup`'s download step still works once
it is online. `/api/health` reports which datasets are available.

## Benchmark data

```bash
npm run datasets
```

Re-downloads anything missing. `python backend/scripts/download_datasets.py --force`
replaces everything; `--only finqa|fab|tau2` limits it to one benchmark. τ-bench v1
data ships inside its Python package.

## Budgets

Every end-to-end run has a spend cap (default $1). Once a few results are in, the
run projects its total cost; if that is over the cap it pauses and asks whether to
continue, before any money past the cap is spent. `DAILY_BUDGET_USD` in
`backend/.env` caps the whole day and survives restarts.

See `backend/README.md` for backend setup and `frontend/README.md` for frontend setup.

# MultiAgent Analysis

Compares single-agent and multi-agent LLM configurations on finance benchmarks
(FinQA, τ-bench retail, τ²-bench retail, FAB): accuracy, cost, latency, audit trail.
WPI MQP × MassMutual.

## Quick start

You need **Git** and **Node.js 18+** installed. That is all: the setup script installs
Python 3.12 for you if you do not have it.

```bash
git clone https://github.com/Bleedingmetal/MultiAgent-Analysis.git
cd MultiAgent-Analysis
python setup.py
```

Open `backend/.env` and paste your keys:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Then run the app:

```bash
python start.py
```

Go to http://localhost:3000. Ctrl-C in that terminal stops everything.

On macOS/Linux use `python3` instead of `python`, or just `./start.sh`. On Windows
you can double-click `start.bat`.

## If you already had the repo cloned

```bash
git pull
python setup.py
python start.py
```

Open a fresh terminal first if an old virtualenv is activated. `setup.py` is safe to
rerun at any time: it keeps your `.env`, moves an old Python 3.10 venv aside and
builds a 3.12 one, and only downloads what is missing.

## What setup.py does

1. Checks Git, Node and npm, and tells you exactly what to install if one is missing.
2. Creates `backend/.venv` on Python 3.12+ (via `uv`, installing it if needed).
3. Installs the Python requirements, including the official `tau_bench` and `tau2`
   benchmark packages from GitHub.
4. Creates `backend/.env` from `.env.example` if you have no `.env`.
5. Downloads the benchmark data into `backend/data/` (not committed).
6. Installs the frontend packages.

`start.py` runs setup itself if the venv or the frontend packages are missing, and
the backend downloads any missing data every time it starts. `npm run setup` and
`npm run dev` are aliases for the two scripts.

## Troubleshooting

- **`python` not found on Windows**: use `py setup.py` and `py start.py`.
- **Port 3000 or 8000 in use**: set `FRONTEND_PORT=3001` or `BACKEND_PORT=8001`
  in your environment before `start.py`.
- **npm errors about a locked file**: close any running dev server or editor that
  has `frontend/node_modules` open and rerun `python setup.py`.
- **Dataset download fails**: the data comes from GitHub (raw.githubusercontent.com).
  Check your network, then `npm run datasets`. `/api/health` lists which datasets
  the backend can see.

## Benchmark data

`npm run datasets` re-downloads anything missing. Full refresh:
`python backend/scripts/download_datasets.py --force`; one benchmark:
`--only finqa|fab|tau2`. τ-bench v1 data ships inside its Python package.

## Budgets

Every end-to-end run has a spend cap (default $1). Once a few results are in, the
run projects its total cost; if that is over the cap it pauses and asks whether to
continue, before any money past the cap is spent. `DAILY_BUDGET_USD` in
`backend/.env` caps the whole day and survives restarts. All defaults use the
cheapest Claude model (Haiku); change models per node in the builder.

See `backend/README.md` for backend details and `frontend/README.md` for the frontend.

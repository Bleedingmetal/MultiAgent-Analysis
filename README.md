# MultiAgent Analysis

Compares single-agent and multi-agent LLM configurations on finance benchmarks
(FinQA, τ-bench retail, τ²-bench retail, FAB): accuracy, cost, latency, audit trail.
WPI MQP × MassMutual.

## Quick start

One command sets everything up. Pick the line for what the machine has:

```bash
git clone https://github.com/Bleedingmetal/MultiAgent-Analysis.git
cd MultiAgent-Analysis
python setup.py        # has Python (python3 on macOS/Linux): installs Node.js too if missing
```

No Python either? `setup.bat` on Windows or `./setup.sh` on macOS/Linux installs it first.
Node.js, Python 3.12, the virtualenv, all packages and the benchmark data are handled by
setup; nothing needs admin rights, and Git is only needed for `git pull`.

Then paste your keys into `backend/.env`:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

and run the app:

```bash
python start.py        # or npm run dev, ./start.sh, start.bat
```

Go to http://localhost:3000. Ctrl-C in that terminal stops both servers. If port
3000 or 8000 is already taken, the next free port is used and printed.

## If you already had the repo cloned

```bash
git pull
npm run dev
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

### Finance Agent Benchmark (FAB) v2.1

- **Data:** the 27-question public split from `vals-ai/finance-agent-v2`, pinned to commit
  `25b6cab` (2026-11-18, the v2.1 data fixes) and checked against its SHA-256. Setup refuses any
  other file and never falls back to the old v1.1 questions. The Validation (450) and Test (449)
  splits are private, so they aren't available here.
- **Tools:** every agent gets research tools. These are SEC EDGAR search and filing lists (free,
  in place of the official sec-api.io), page fetching, document retrieval and a calculator. Web
  search turns on with `TAVILY_API_KEY`, and price history with `TIINGO_API_KEY` (a free Tiingo
  key works). Without a price key, the questions that need market prices usually fail.
- **Grading:** every rubric criterion is judged pass or fail, and hedged answers fail.
  - **Partial Credit** (the headline number) is 0 if any must-pass criterion fails; otherwise it
    is the severity-weighted share of criteria met.
  - **All-Pass** means every criterion was met.
  - Each judge's verdict and reason is stored on the run.
- **Not official:** the judges are set by `FAB_JUDGE_MODELS` (default: Haiku 5.5, majority vote
  per criterion). The official jury (three frontier models, unpublished prompt and aggregation)
  isn't public, so scores compare our configurations with each other but not with the vals.ai
  leaderboard.

## Re-grading FinQA after a scoring fix

When the FinQA checker changes, re-grade the runs you already have instead of paying
for new ones. It re-checks each stored answer; no model is called.

```
npm run regrade:check   # show what would change
npm run regrade         # apply it (backs up backend/data first), then restart the app
```

## Budgets

Every end-to-end run has a spend cap (default $1). Once a few results are in, the
run projects its total cost; if that is over the cap it pauses and asks whether to
continue, before any money past the cap is spent. `DAILY_BUDGET_USD` in
`backend/.env` caps the whole day and survives restarts. All defaults use the
cheapest Claude model (Haiku); change models per node in the builder.

See `backend/README.md` for backend details and `frontend/README.md` for the frontend.

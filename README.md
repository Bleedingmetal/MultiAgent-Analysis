# MultiAgent Analysis

Compares single-agent and multi-agent LLM configurations on finance benchmarks
(FinQA, τ-bench retail, τ²-bench retail, FAB): accuracy, cost, latency, audit trail.

## Setup and run (fresh clone)

You need Git and Node.js 18+. Python 3.12+ is needed too, but the setup script
installs one for you (through `uv`) if it is missing. Then:

```bash
python setup.py        # once: venv, Python packages, frontend packages, data, backend/.env
```

Put your keys in `backend/.env` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), then:

```bash
python start.py        # or ./start.sh on macOS/Linux, start.bat on Windows
```

That runs the backend on http://localhost:8000 and the app on http://localhost:3000
and stops both on Ctrl-C. `start.py` runs setup itself if the venv or the frontend
packages are missing, so on a clean machine `python start.py` alone is enough once
the keys are in place. The backend also downloads any missing benchmark data when
it starts, and `/api/health` reports which datasets are available.

`npm run setup` and `npm run dev` do the same as the two scripts above.

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

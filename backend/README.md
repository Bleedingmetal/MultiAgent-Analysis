# Agent Evaluation API

## Setup

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# put OPENAI_API_KEY in .env
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

- `single-agent` — one cheap OpenAI call (`gpt-4o-mini` by default), FinQA scored
- `classify-plan` — classifier suggests multi-agent roles (no workers yet)

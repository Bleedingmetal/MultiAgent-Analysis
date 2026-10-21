# MultiAgent Analysis

## Setup and development

From the repository root:

```bash
npm install
npm run setup
npm run dev
```

`npm run dev` starts the FastAPI backend on port 8000 and the Next.js
frontend on port 3000 (or the next available port).

## Download benchmark datasets

From the repository root:

```bash
make datasets
```

This downloads FinQA, FAB, and τ-bench retail data into `backend/data/`.
`npm run dev` also runs this check first. Existing files are reused without a
network request, so datasets are downloaded only when missing. To re-download
everything:

```bash
python3 backend/scripts/download_datasets.py --force
```

Download only one benchmark with `--only finqa`, `--only fab`, or `--only tau`.

See `backend/README.md` for backend setup and `frontend/README.md` for frontend setup.

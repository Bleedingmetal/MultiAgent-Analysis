from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from app.schemas import RunResult

# RUNS_DIR lets tests and throwaway servers keep their runs out of real history.
DATA_DIR = (
    Path(os.environ["RUNS_DIR"]).expanduser()
    if os.environ.get("RUNS_DIR")
    else Path(__file__).resolve().parents[1] / "data" / "runs"
)
RUNS_FILE = DATA_DIR / "history.jsonl"

_lock = threading.Lock()
_runs: list[RunResult] = []
_loaded = False


def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if RUNS_FILE.exists():
            loaded: list[RunResult] = []
            with RUNS_FILE.open(encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        loaded.append(RunResult.model_validate_json(line))
                    except Exception:
                        continue
            # newest first
            loaded.reverse()
            _runs.extend(loaded)
        _loaded = True


def add_run(run: RunResult) -> RunResult:
    _ensure_loaded()
    with _lock:
        _runs.insert(0, run)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with RUNS_FILE.open("a", encoding="utf-8") as f:
            f.write(run.model_dump_json() + "\n")
        # memory bound
        del _runs[500:]
    return run


def list_runs(limit: int = 50) -> list[RunResult]:
    _ensure_loaded()
    return _runs[:limit]


def get_run(run_id: str) -> RunResult | None:
    _ensure_loaded()
    for run in _runs:
        if run.id == run_id:
            return run
    return None

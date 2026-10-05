from __future__ import annotations

from app.schemas import RunResult

_runs: list[RunResult] = []


def add_run(run: RunResult) -> RunResult:
    _runs.insert(0, run)
    # keep memory bounded
    del _runs[100:]
    return run


def list_runs(limit: int = 50) -> list[RunResult]:
    return _runs[:limit]


def get_run(run_id: str) -> RunResult | None:
    for run in _runs:
        if run.id == run_id:
            return run
    return None

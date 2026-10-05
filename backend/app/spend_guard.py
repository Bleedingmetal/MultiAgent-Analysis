from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date

from app.config import settings


@dataclass
class SpendState:
    day: str = field(default_factory=lambda: date.today().isoformat())
    spend_usd: float = 0.0
    run_count: int = 0
    last_run_at: float = 0.0
    in_flight: bool = False


_state = SpendState()


def _roll_day() -> None:
    today = date.today().isoformat()
    if _state.day != today:
        _state.day = today
        _state.spend_usd = 0.0
        _state.run_count = 0


def status() -> dict:
    _roll_day()
    s = settings()
    return {
        "day": _state.day,
        "spend_usd": round(_state.spend_usd, 6),
        "run_count": _state.run_count,
        "daily_budget_usd": s["daily_budget_usd"],
        "max_runs_per_day": s["max_runs_per_day"],
        "min_seconds_between_runs": s["min_seconds_between_runs"],
        "max_completion_tokens": s["max_completion_tokens"],
        "in_flight": _state.in_flight,
        "remaining_budget_usd": round(
            max(0.0, s["daily_budget_usd"] - _state.spend_usd), 6
        ),
        "remaining_runs": max(0, s["max_runs_per_day"] - _state.run_count),
    }


def begin_run() -> None:
    """Raise RuntimeError if this run should be blocked."""
    _roll_day()
    s = settings()

    if _state.in_flight:
        raise RuntimeError("Another run is already in progress. Wait for it to finish.")

    if _state.run_count >= s["max_runs_per_day"]:
        raise RuntimeError(
            f"Daily run cap hit ({s['max_runs_per_day']} runs). "
            "Raise MAX_RUNS_PER_DAY in backend/.env if you need more."
        )

    if _state.spend_usd >= s["daily_budget_usd"]:
        raise RuntimeError(
            f"Daily spend cap hit (${s['daily_budget_usd']:.2f}). "
            "Raise DAILY_BUDGET_USD in backend/.env if you need more."
        )

    elapsed = time.time() - _state.last_run_at
    wait = s["min_seconds_between_runs"]
    if _state.last_run_at and elapsed < wait:
        raise RuntimeError(
            f"Slow down: wait {wait - elapsed:.0f}s between runs "
            f"(MIN_SECONDS_BETWEEN_RUNS={wait})."
        )

    _state.in_flight = True


def end_run(*, cost_usd: float, ok: bool) -> None:
    _roll_day()
    _state.in_flight = False
    _state.last_run_at = time.time()
    if ok:
        _state.run_count += 1
        _state.spend_usd += max(0.0, cost_usd)

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Explicit path: a bare load_dotenv() searches from the cwd in uvicorn's reload
# worker, missing backend/.env and silently keeping stale OS-level keys.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def key_configured(key: str) -> bool:
    """True when a real key is set (not empty / not the .env.example placeholder)."""
    return bool(key) and "your-key" not in key


@lru_cache
def settings() -> dict:
    return {
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", ""),
        "google_api_key": os.getenv("GOOGLE_API_KEY", ""),
        # Model for anything without its own (provider inferred from the id).
        "default_model": os.getenv("DEFAULT_MODEL", "claude-opus-5-5"),
        # Used when a node picks OpenAI but no specific model.
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "cors_origins": [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000,"
                "http://localhost:3001,http://127.0.0.1:3001",
            ).split(",")
            if o.strip()
        ],
        # Fallback USD / 1M tokens for models missing from app.pricing
        "price_input_per_mtok": float(os.getenv("PRICE_INPUT_PER_MTOK", "0.15")),
        "price_output_per_mtok": float(
            os.getenv("PRICE_OUTPUT_PER_MTOK", "0.60")
        ),
        # safety rails (cheap MVP defaults)
        "max_completion_tokens": int(os.getenv("MAX_COMPLETION_TOKENS", "600")),
        "max_prompt_chars": int(os.getenv("MAX_PROMPT_CHARS", "6000")),
        # System prompts are rendered from role templates in prompt chains.
        "max_system_chars": int(os.getenv("MAX_SYSTEM_CHARS", "3000")),
        "max_chain_steps": int(os.getenv("MAX_CHAIN_STEPS", "6")),
        "daily_budget_usd": float(os.getenv("DAILY_BUDGET_USD", "1.00")),
        "max_runs_per_day": int(os.getenv("MAX_RUNS_PER_DAY", "25")),
        "min_seconds_between_runs": float(
            os.getenv("MIN_SECONDS_BETWEEN_RUNS", "8")
        ),
        "require_confirm": os.getenv("REQUIRE_CONFIRM", "true").lower()
        in {"1", "true", "yes"},
        # multi-agent pipeline limits
        "max_llm_calls_per_run": int(os.getenv("MAX_LLM_CALLS_PER_RUN", "24")),
        "max_run_cost_usd": float(os.getenv("MAX_RUN_COST_USD", "0.25")),
        "max_tool_steps": int(os.getenv("MAX_TOOL_STEPS", "6")),
        # Claude 5.x thinks by default and thinking tokens count toward max_tokens,
        # so Claude calls get this floor instead of MAX_COMPLETION_TOKENS.
        "anthropic_max_tokens": int(os.getenv("ANTHROPIC_MAX_TOKENS", "4000")),
        "max_eval_rounds": int(os.getenv("MAX_EVAL_ROUNDS", "3")),
        # tau-bench retail (both generations): the simulated customer, the LLM judge
        # tau2 uses for natural-language checks, the turn cap, and where tau2's data lives
        "tau_user_model": os.getenv("TAU_USER_MODEL", "gpt-4o-mini"),
        "tau_judge_model": os.getenv("TAU_JUDGE_MODEL", "gpt-4o-mini"),
        "tau_max_steps": int(os.getenv("TAU_MAX_STEPS", "60")),
        "tau2_data_dir": Path(
            os.getenv("TAU2_DATA_DIR") or (Path(__file__).resolve().parents[1] / "data")
        ),
    }

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv(override=True)


@lru_cache
def settings() -> dict:
    return {
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
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
        # gpt-4o-mini approximate USD / 1M tokens
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
    }

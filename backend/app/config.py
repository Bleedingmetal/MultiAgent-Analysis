from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Explicit path: a bare load_dotenv() searches from the cwd in uvicorn's reload
# worker, missing backend/.env and silently keeping stale OS-level keys.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_FILE, override=True)



# Prompt cap floor: see max_prompt_chars below.
MIN_PROMPT_CHARS = 12000

def key_configured(key: str) -> bool:
    """True when a real key is set (not empty / not the .env.example placeholder)."""
    return bool(key) and "your-key" not in key


def _env_mtime() -> float | None:
    try:
        return ENV_FILE.stat().st_mtime
    except OSError:
        return None


_loaded_mtime = _env_mtime()


def settings() -> dict:
    """The current settings. An edit to backend/.env takes effect on the next call, no restart."""
    global _loaded_mtime
    mtime = _env_mtime()
    if mtime != _loaded_mtime:
        _loaded_mtime = mtime
        load_dotenv(ENV_FILE, override=True)
        _settings.cache_clear()
    return _settings()


# kept so callers that clear settings (tests, dataset reload) still can
settings.cache_clear = lambda: _settings.cache_clear()  # type: ignore[attr-defined]


@lru_cache
def _settings() -> dict:
    return {
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", ""),
        "google_api_key": os.getenv("GOOGLE_API_KEY", ""),
        # Model for anything without its own (provider inferred from the id).
        "default_model": os.getenv("DEFAULT_MODEL", "claude-haiku-5-5"),
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
        # The longest FinQA filing context is about 9,000 characters; below 12,000 the
        # evidence a question needs gets cut out of the prompt, so lower values are raised.
        "max_prompt_chars": max(MIN_PROMPT_CHARS, int(os.getenv("MAX_PROMPT_CHARS", str(MIN_PROMPT_CHARS)))),
        # System prompts are rendered from role templates in prompt chains.
        "max_system_chars": int(os.getenv("MAX_SYSTEM_CHARS", "3000")),
        "max_chain_steps": int(os.getenv("MAX_CHAIN_STEPS", "6")),
        "daily_budget_usd": float(os.getenv("DAILY_BUDGET_USD", "1.00")),
        # The default spend cap filled in for an end-to-end run (one run of many questions)
        "run_budget_usd": float(os.getenv("RUN_BUDGET_USD", "1.00")),
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
        "tau_user_model": os.getenv("TAU_USER_MODEL", "claude-haiku-5-5"),
        "tau_judge_model": os.getenv("TAU_JUDGE_MODEL", "claude-haiku-5-5"),
        "tau_max_steps": int(os.getenv("TAU_MAX_STEPS", "60")),
        # Finance Agent Benchmark v2.1. The official grader is a jury of three frontier
        # models; FAB_JUDGE_MODELS sets ours (comma-separated, majority vote per criterion).
        "fab_judge_models": [
            m.strip() for m in os.getenv("FAB_JUDGE_MODELS", "claude-haiku-5-5").split(",") if m.strip()
        ],
        "fab_retrieval_model": os.getenv("FAB_RETRIEVAL_MODEL", "claude-haiku-5-5"),
        "fab_max_tool_steps": int(os.getenv("FAB_MAX_TOOL_STEPS", "16")),
        "fab_max_llm_calls": int(os.getenv("FAB_MAX_LLM_CALLS", "80")),
        # SEC asks automated clients to identify themselves; set your organisation and contact
        "sec_user_agent": os.getenv("SEC_USER_AGENT", "AgentEvaluation research-harness admin@example.org"),
        # Optional: the official web_search (Tavily) and price_history (Tiingo) tools
        "tavily_api_key": os.getenv("TAVILY_API_KEY", "").strip(),
        "tiingo_api_key": (os.getenv("TIINGO_API_KEY") or os.getenv("PRICING_DATA_API_KEY") or "").strip(),
        "tau2_data_dir": Path(
            os.getenv("TAU2_DATA_DIR") or (Path(__file__).resolve().parents[1] / "data")
        ),
    }

from __future__ import annotations

from app.config import settings

# USD per 1M tokens (input, output). List prices; update when vendors change them.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    # OpenAI
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "o4-mini": (1.10, 4.40),
    # Anthropic
    "claude-haiku-5-5": (0.10, 0.50),  # prompts <= 100K tokens
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-fable-5-1": (10.00, 50.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-4-5": (3.00, 15.00),
    "claude-opus-4-5": (5.00, 25.00),
    # Google
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-pro": (1.25, 10.00),
}


def price_for(model: str) -> tuple[float, float]:
    if model in MODEL_PRICES:
        return MODEL_PRICES[model]
    # Dated snapshots like claude-sonnet-4-5-20250929 / gpt-4o-mini-2024-07-18
    for name in sorted(MODEL_PRICES, key=len, reverse=True):
        if model.startswith(name):
            return MODEL_PRICES[name]
    s = settings()
    return s["price_input_per_mtok"], s["price_output_per_mtok"]


def cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    price_in, price_out = price_for(model)
    return prompt_tokens / 1_000_000 * price_in + completion_tokens / 1_000_000 * price_out

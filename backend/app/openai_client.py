from __future__ import annotations

from openai import OpenAI

from app.config import settings

# Approximate USD per 1M tokens (input, output) for models offered in the UI.
# Estimates for relative comparison, not billing. Unknown models fall back to
# PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "o4-mini": (1.10, 4.40),
}


def get_client() -> OpenAI:
    key = settings()["openai_api_key"]
    if not key or key.startswith("sk-your-key"):
        raise RuntimeError(
            "OPENAI_API_KEY missing. Copy backend/.env.example to backend/.env and set your key."
        )
    return OpenAI(api_key=key)


def _price_for(model: str | None) -> tuple[float, float]:
    if model:
        name = model.strip().lower()
        # Longest id first so "gpt-4o-mini-2024-07-18" is not priced as "gpt-4o".
        for known in sorted(MODEL_PRICES, key=len, reverse=True):
            if name == known or name.startswith(known + "-"):
                return MODEL_PRICES[known]
    s = settings()
    return s["price_input_per_mtok"], s["price_output_per_mtok"]


def estimate_cost(
    prompt_tokens: int, completion_tokens: int, model: str | None = None
) -> float:
    price_in, price_out = _price_for(model)
    return (
        prompt_tokens / 1_000_000 * price_in
        + completion_tokens / 1_000_000 * price_out
    )


def truncate_prompt(text: str, max_chars: int | None = None) -> str:
    limit = max_chars if max_chars is not None else settings()["max_prompt_chars"]
    if len(text) <= limit:
        return text
    keep = max(0, limit - 40)
    return text[:keep] + "\n\n[truncated for spend safety]"


def chat_completion(
    *,
    system: str,
    user: str,
    temperature: float = 0.5,
    model: str | None = None,
    max_tokens: int | None = None,
) -> tuple[str, int, int]:
    client = get_client()
    s = settings()
    used_model = model or s["openai_model"]
    # A per-call value can lower the spend-safety cap but never raise it.
    cap = s["max_completion_tokens"]
    limit = min(max_tokens, cap) if max_tokens else cap
    resp = client.chat.completions.create(
        model=used_model,
        temperature=temperature,
        max_tokens=limit,
        messages=[
            {
                "role": "system",
                "content": truncate_prompt(system, s["max_system_chars"]),
            },
            {"role": "user", "content": truncate_prompt(user)},
        ],
    )
    content = (resp.choices[0].message.content or "").strip()
    usage = resp.usage
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    return content, prompt_tokens, completion_tokens

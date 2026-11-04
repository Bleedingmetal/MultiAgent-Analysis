"""Single-call helpers used by the prompt-chain, routing, and classifier runners.

Despite the historical module name, calls go through the provider-agnostic layer in
`app.llm`, so OpenAI, Anthropic, and Google models all work. The provider is inferred
from the model id (claude-* -> Anthropic, gemini-* -> Google, otherwise OpenAI).
"""

from __future__ import annotations

from app.config import settings
from app.llm import complete, infer_provider, providers_status, require_provider
from app.pricing import cost_usd


def get_client() -> None:
    """Fail fast when no provider key is configured at all.

    Per-model checks happen in `require_provider` when a step's model is resolved.
    """
    if not any(providers_status().values()):
        raise RuntimeError(
            "No LLM API key configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY "
            "in backend/.env."
        )


def estimate_cost(
    prompt_tokens: int, completion_tokens: int, model: str | None = None
) -> float:
    return cost_usd(model or settings()["openai_model"], prompt_tokens, completion_tokens)


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
    s = settings()
    used_model = model or s["openai_model"]
    provider = infer_provider(used_model)
    require_provider(provider, used_model)
    # A per-call value can lower the spend-safety cap but never raise it.
    cap = s["max_completion_tokens"]
    limit = min(max_tokens, cap) if max_tokens else cap
    result = complete(
        provider=provider,
        model=used_model,
        system=truncate_prompt(system, s["max_system_chars"]),
        user=truncate_prompt(user),
        temperature=temperature,
        max_tokens=limit,
    )
    return result.text, result.prompt_tokens, result.completion_tokens

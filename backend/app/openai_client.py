from __future__ import annotations

from openai import OpenAI

from app.config import settings


def get_client() -> OpenAI:
    key = settings()["openai_api_key"]
    if not key or key.startswith("sk-your-key"):
        raise RuntimeError(
            "OPENAI_API_KEY missing. Copy backend/.env.example to backend/.env and set your key."
        )
    return OpenAI(api_key=key)


def estimate_cost(prompt_tokens: int, completion_tokens: int) -> float:
    s = settings()
    return (
        prompt_tokens / 1_000_000 * s["price_input_per_mtok"]
        + completion_tokens / 1_000_000 * s["price_output_per_mtok"]
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
) -> tuple[str, int, int]:
    client = get_client()
    s = settings()
    used_model = model or s["openai_model"]
    resp = client.chat.completions.create(
        model=used_model,
        temperature=temperature,
        max_tokens=s["max_completion_tokens"],
        messages=[
            {"role": "system", "content": truncate_prompt(system, 1500)},
            {"role": "user", "content": truncate_prompt(user)},
        ],
    )
    content = (resp.choices[0].message.content or "").strip()
    usage = resp.usage
    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    return content, prompt_tokens, completion_tokens

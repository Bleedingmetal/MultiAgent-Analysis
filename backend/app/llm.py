"""Provider-agnostic LLM calls (OpenAI, Anthropic, Gemini) with an optional tool loop."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Callable

from app.config import key_configured, settings
from app.pricing import cost_usd

GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

SUPPORTED_PROVIDERS = {"openai", "anthropic", "google"}


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCallRecord:
    name: str
    arguments: dict[str, Any]
    result: str


@dataclass
class LLMResult:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    # Of prompt_tokens, served from the provider's prompt cache (cheaper)
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0
    # Number of API round trips (>1 when tools were used)
    calls: int = 1
    tool_calls: list[ToolCallRecord] = field(default_factory=list)


ToolExecutor = Callable[[str, dict[str, Any]], str]

# Prompt caching. Anthropic caches everything up to a marked block; the system prompt,
# the tool list and the latest message are marked so each turn only pays full price
# for what is new. OpenAI caches automatically and just reports the cached count.
CACHE: dict[str, str] = {"type": "ephemeral"}


def anthropic_usage(usage) -> tuple[int, int, int]:
    """(all input tokens, cache reads, cache writes). Anthropic's input_tokens excludes cached."""
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return (usage.input_tokens or 0) + read + write, read, write


def openai_cached_tokens(usage) -> int:
    details = getattr(usage, "prompt_tokens_details", None)
    return (getattr(details, "cached_tokens", 0) or 0) if details else 0
# Called before every API round trip so the caller can enforce budgets.
BeforeCall = Callable[[], None]


def infer_provider(model: str) -> str:
    m = model.lower()
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith("gemini"):
        return "google"
    return "openai"


def litellm_name(model: str) -> str:
    """'provider/model' as litellm wants it, so new model ids it has not heard of still route."""
    if "/" in model:
        return model
    provider = infer_provider(model)
    return f"{'gemini' if provider == 'google' else provider}/{model}"


def default_provider() -> str:
    return infer_provider(settings()["default_model"])


def default_model_for(provider: str) -> str:
    """Model to use when a node names a provider but no (real) model."""
    if provider == default_provider():
        return settings()["default_model"]
    # Cheapest model of each provider: internal testing runs on the low end
    if provider == "anthropic":
        return "claude-haiku-5-5"
    if provider == "google":
        return "gemini-2.0-flash"
    return settings()["openai_model"]


def provider_configured(provider: str) -> bool:
    s = settings()
    if provider == "openai":
        return key_configured(s["openai_api_key"])
    if provider == "anthropic":
        return key_configured(s["anthropic_api_key"])
    if provider == "google":
        return key_configured(s["google_api_key"])
    return False


def providers_status() -> dict[str, bool]:
    return {p: provider_configured(p) for p in ("openai", "anthropic", "google")}


_KEY_HINT = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
}


def require_provider(provider: str, model: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise RuntimeError(
            f"Provider '{provider}' (model {model}) is not supported yet. "
            "Use OpenAI, Anthropic, or Google."
        )
    if not provider_configured(provider):
        raise RuntimeError(
            f"{_KEY_HINT[provider]} missing in backend/.env — needed for {provider} model {model}."
        )


@lru_cache
def _openai_client():
    from openai import OpenAI

    return OpenAI(api_key=settings()["openai_api_key"])


@lru_cache
def _gemini_client():
    from openai import OpenAI

    return OpenAI(api_key=settings()["google_api_key"], base_url=GEMINI_OPENAI_BASE_URL)


@lru_cache
def _anthropic_client():
    from anthropic import Anthropic

    return Anthropic(api_key=settings()["anthropic_api_key"])


def _is_openai_reasoning_model(model: str) -> bool:
    # o-series and gpt-5 reject custom temperature
    return bool(re.match(r"^(o\d|gpt-5)", model.lower()))


def complete(
    *,
    provider: str,
    model: str,
    system: str,
    user: str,
    temperature: float = 0.5,
    max_tokens: int | None = None,
    tools: list[ToolSpec] | None = None,
    tool_executor: ToolExecutor | None = None,
    max_tool_steps: int | None = None,
    before_call: BeforeCall | None = None,
) -> LLMResult:
    """One logical agent turn. With tools, loops until the model stops calling them."""
    require_provider(provider, model)
    s = settings()
    max_tokens = max_tokens or s["max_completion_tokens"]
    max_tool_steps = max_tool_steps if max_tool_steps is not None else s["max_tool_steps"]
    if tools and tool_executor is None:
        raise ValueError("tool_executor required when tools are given")

    if provider == "anthropic":
        max_tokens = max(max_tokens, s["anthropic_max_tokens"])
        result = _anthropic_turn(
            model, system, user, temperature, max_tokens,
            tools or [], tool_executor, max_tool_steps, before_call,
        )
    else:
        client = _gemini_client() if provider == "google" else _openai_client()
        result = _openai_turn(
            client, provider, model, system, user, temperature, max_tokens,
            tools or [], tool_executor, max_tool_steps, before_call,
        )
    result.cost_usd = cost_usd(
        model, result.prompt_tokens, result.completion_tokens,
        cache_read_tokens=result.cache_read_tokens, cache_write_tokens=result.cache_write_tokens,
    )
    return result


def _openai_turn(
    client,
    provider: str,
    model: str,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    tools: list[ToolSpec],
    tool_executor: ToolExecutor | None,
    max_tool_steps: int,
    before_call: BeforeCall | None,
) -> LLMResult:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    kwargs: dict[str, Any] = {"model": model}
    if provider == "openai":
        kwargs["max_completion_tokens"] = max_tokens
    else:
        kwargs["max_tokens"] = max_tokens
    if not _is_openai_reasoning_model(model):
        kwargs["temperature"] = temperature
    if tools:
        kwargs["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in tools
        ]

    out = LLMResult(text="", calls=0)
    for step in range(max_tool_steps + 1):
        # Last round: force a text answer instead of another tool call
        if tools and step == max_tool_steps:
            kwargs["tool_choice"] = "none"
        if before_call:
            before_call()
        resp = client.chat.completions.create(messages=messages, **kwargs)
        out.calls += 1
        if resp.usage:
            out.prompt_tokens += resp.usage.prompt_tokens or 0
            out.completion_tokens += resp.usage.completion_tokens or 0
            out.cache_read_tokens += openai_cached_tokens(resp.usage)
        msg = resp.choices[0].message
        calls = msg.tool_calls or []
        if not calls:
            out.text = (msg.content or "").strip()
            return out
        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.function.name, "arguments": c.function.arguments},
                    }
                    for c in calls
                ],
            }
        )
        for c in calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = tool_executor(c.function.name, args)  # type: ignore[misc]
            out.tool_calls.append(ToolCallRecord(c.function.name, args, result))
            messages.append({"role": "tool", "tool_call_id": c.id, "content": result})
    return out


def _anthropic_turn(
    model: str,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    tools: list[ToolSpec],
    tool_executor: ToolExecutor | None,
    max_tool_steps: int,
    before_call: BeforeCall | None,
) -> LLMResult:
    client = _anthropic_client()
    # The task prompt is marked cacheable too, so tool-loop follow-ups reuse it.
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": [{"type": "text", "text": user, "cache_control": CACHE}]}
    ]
    # The Messages API no longer accepts `temperature` ("Extra inputs are not
    # permitted"), so the node's temperature setting is ignored for Claude.
    kwargs: dict[str, Any] = {
        "model": model,
        "system": [{"type": "text", "text": system, "cache_control": CACHE}],
        "max_tokens": max_tokens,
    }
    if tools:
        kwargs["tools"] = [
            {"name": t.name, "description": t.description, "input_schema": t.parameters}
            for t in tools
        ]
        kwargs["tools"][-1]["cache_control"] = CACHE

    out = LLMResult(text="", calls=0)
    for step in range(max_tool_steps + 1):
        if tools and step == max_tool_steps:
            kwargs["tool_choice"] = {"type": "none"}
        if before_call:
            before_call()
        resp = client.messages.create(messages=messages, **kwargs)
        out.calls += 1
        prompt, read, write = anthropic_usage(resp.usage)
        out.prompt_tokens += prompt
        out.cache_read_tokens += read
        out.cache_write_tokens += write
        out.completion_tokens += resp.usage.output_tokens or 0
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        uses = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not uses:
            if not text and resp.stop_reason == "max_tokens":
                raise RuntimeError(
                    f"{model} used its whole output budget ({max_tokens} tokens) on thinking "
                    "and returned no answer. Raise ANTHROPIC_MAX_TOKENS in backend/.env."
                )
            if not text and resp.stop_reason == "refusal":
                raise RuntimeError(f"{model} declined the request (stop_reason=refusal).")
            out.text = text
            return out
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for b in uses:
            args = dict(b.input) if isinstance(b.input, dict) else {}
            result = tool_executor(b.name, args)  # type: ignore[misc]
            out.tool_calls.append(ToolCallRecord(b.name, args, result))
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": result})
        messages.append({"role": "user", "content": results})
    return out

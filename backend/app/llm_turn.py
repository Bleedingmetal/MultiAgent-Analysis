"""One conversational turn with tools *offered*, not executed.

`app.llm.complete` runs a whole tool loop itself, which is right for FinQA-style
calculators. A tau-bench conversation is different: the benchmark's environment
executes every tool and the user simulator replies, so the agent must hand its
tool calls back to the orchestrator. `chat_turn` does exactly one model round trip
over an OpenAI-style message list and returns text and/or tool calls.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.llm import (
    _anthropic_client,
    _gemini_client,
    _is_openai_reasoning_model,
    _openai_client,
    require_provider,
)
from app.pricing import cost_usd


@dataclass
class TurnToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class TurnResult:
    text: str
    tool_calls: list[TurnToolCall] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0


def chat_turn(
    *,
    provider: str,
    model: str,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    temperature: float = 0.0,
    max_tokens: int | None = None,
) -> TurnResult:
    """`messages` use OpenAI chat roles: user / assistant (with optional `tool_calls`
    as [{id, name, arguments: dict}]) / tool (with `tool_call_id`). `tools` are OpenAI
    function schemas ({"type": "function", "function": {name, description, parameters}})."""
    require_provider(provider, model)
    s = settings()
    max_tokens = max_tokens or s["max_completion_tokens"]
    if provider == "anthropic":
        result = _anthropic_turn(model, system, messages, tools or [], temperature,
                                 max(max_tokens, s["anthropic_max_tokens"]))
    else:
        client = _gemini_client() if provider == "google" else _openai_client()
        result = _openai_turn(client, provider, model, system, messages, tools or [], temperature, max_tokens)
    result.cost_usd = cost_usd(model, result.prompt_tokens, result.completion_tokens)
    return result


# ---- OpenAI-compatible ---------------------------------------------------------------

def _openai_turn(client, provider, model, system, messages, tools, temperature, max_tokens) -> TurnResult:
    wire: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] == "assistant":
            entry: dict[str, Any] = {"role": "assistant", "content": m.get("content") or None}
            if m.get("tool_calls"):
                entry["tool_calls"] = [
                    {
                        "id": c["id"],
                        "type": "function",
                        "function": {"name": c["name"], "arguments": json.dumps(c["arguments"])},
                    }
                    for c in m["tool_calls"]
                ]
            wire.append(entry)
        elif m["role"] == "tool":
            wire.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m.get("content") or ""})
        else:
            wire.append({"role": "user", "content": m.get("content") or ""})
    kwargs: dict[str, Any] = {"model": model, "messages": wire}
    if provider == "openai":
        kwargs["max_completion_tokens"] = max_tokens
    else:
        kwargs["max_tokens"] = max_tokens
    if not _is_openai_reasoning_model(model):
        kwargs["temperature"] = temperature
    if tools:
        kwargs["tools"] = tools
    resp = client.chat.completions.create(**kwargs)
    msg = resp.choices[0].message
    calls = []
    for c in msg.tool_calls or []:
        try:
            args = json.loads(c.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append(TurnToolCall(id=c.id or f"call_{uuid.uuid4().hex[:8]}", name=c.function.name, arguments=args))
    usage = resp.usage
    return TurnResult(
        text=(msg.content or "").strip(),
        tool_calls=calls,
        prompt_tokens=(usage.prompt_tokens or 0) if usage else 0,
        completion_tokens=(usage.completion_tokens or 0) if usage else 0,
    )


# ---- Anthropic -----------------------------------------------------------------------

def _anthropic_turn(model, system, messages, tools, temperature, max_tokens) -> TurnResult:
    client = _anthropic_client()
    wire: list[dict[str, Any]] = []
    for m in messages:
        if m["role"] == "assistant":
            blocks: list[dict[str, Any]] = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for c in m.get("tool_calls") or []:
                blocks.append({"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["arguments"]})
            if blocks:
                wire.append({"role": "assistant", "content": blocks})
        elif m["role"] == "tool":
            block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m.get("content") or ""}
            # Consecutive tool results belong in one user message
            if wire and wire[-1]["role"] == "user" and isinstance(wire[-1]["content"], list) \
                    and wire[-1]["content"] and wire[-1]["content"][0].get("type") == "tool_result":
                wire[-1]["content"].append(block)
            else:
                wire.append({"role": "user", "content": [block]})
        else:
            wire.append({"role": "user", "content": m.get("content") or ""})
    # Anthropic requires alternating roles; merge adjacent same-role plain messages
    merged: list[dict[str, Any]] = []
    for entry in wire:
        if merged and merged[-1]["role"] == entry["role"] and isinstance(merged[-1]["content"], str) \
                and isinstance(entry["content"], str):
            merged[-1]["content"] += "\n\n" + entry["content"]
        else:
            merged.append(entry)
    if not merged or merged[0]["role"] != "user":
        merged.insert(0, {"role": "user", "content": "(conversation start)"})
    kwargs: dict[str, Any] = {"model": model, "system": system, "max_tokens": max_tokens, "messages": merged}
    if tools:
        kwargs["tools"] = [
            {"name": t["function"]["name"], "description": t["function"].get("description", ""),
             "input_schema": t["function"].get("parameters") or {"type": "object", "properties": {}}}
            for t in tools
        ]
    resp = client.messages.create(**kwargs)
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    calls = [
        TurnToolCall(id=b.id, name=b.name, arguments=dict(b.input) if isinstance(b.input, dict) else {})
        for b in resp.content if b.type == "tool_use"
    ]
    return TurnResult(
        text=text,
        tool_calls=calls,
        prompt_tokens=resp.usage.input_tokens or 0,
        completion_tokens=resp.usage.output_tokens or 0,
    )

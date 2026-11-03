"""Tools that Tool nodes expose to agent nodes (autonomous / tool-using agents)."""

from __future__ import annotations

import ast
import math
import operator
import re
from typing import Any, Callable

from app.datasets.registry import Task
from app.llm import ToolSpec

TOOL_KINDS = ("calculator", "context_search")

_BIN_OPS: dict[type, Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPS: dict[type, Callable[[Any], Any]] = {ast.USub: operator.neg, ast.UAdd: operator.pos}
_FUNCS: dict[str, Callable[..., Any]] = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": lambda *xs: sum(xs),
    "sqrt": math.sqrt,
    "log": math.log,
    "exp": math.exp,
}


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        left, right = _eval_node(node.left), _eval_node(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        return _BIN_OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return _UNARY_OPS[type(node.op)](_eval_node(node.operand))
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _FUNCS
        and not node.keywords
    ):
        return _FUNCS[node.func.id](*[_eval_node(a) for a in node.args])
    raise ValueError(f"unsupported expression element: {type(node).__name__}")


def calculate(expression: str) -> str:
    expr = expression.replace(",", "").replace("%", "/100").strip()
    if len(expr) > 300:
        return "error: expression too long"
    try:
        value = _eval_node(ast.parse(expr, mode="eval"))
    except ZeroDivisionError:
        return "error: division by zero"
    except Exception as exc:  # noqa: BLE001
        return f"error: {exc}"
    if isinstance(value, float):
        return f"{value:.10g}"
    return str(value)


def search_context(context: str, query: str, limit: int = 6) -> str:
    """Return the task-context lines that share the most words with the query."""
    terms = {t for t in re.findall(r"[a-z0-9.]+", query.lower()) if len(t) > 1}
    if not terms:
        return "error: empty query"
    lines = [ln.strip() for ln in re.split(r"\n|(?<=\.)\s+", context) if ln.strip()]
    scored = []
    for i, line in enumerate(lines):
        words = set(re.findall(r"[a-z0-9.]+", line.lower()))
        hits = len(terms & words)
        if hits:
            scored.append((hits, -i, line))
    if not scored:
        return "no matching lines"
    scored.sort(reverse=True)
    return "\n".join(line[:400] for _, _, line in scored[:limit])


_SPECS: dict[str, ToolSpec] = {
    "calculator": ToolSpec(
        name="calculator",
        description=(
            "Evaluate an arithmetic expression exactly. Supports + - * / **, parentheses, "
            "and abs, round, min, max, sum, sqrt, log, exp. A trailing % means percent "
            "(5% = 0.05). Example: (5829 - 5735) / 5735"
        ),
        parameters={
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    ),
    "context_search": ToolSpec(
        name="context_search",
        description=(
            "Search the task's provided documents (text and table rows) for lines matching "
            "keywords. Use to locate exact figures."
        ),
        parameters={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    ),
}


def tool_kind_for(node_name: str, metadata: dict[str, Any] | None) -> str:
    kind = (metadata or {}).get("tool")
    if isinstance(kind, str) and kind in TOOL_KINDS:
        return kind
    name = node_name.lower()
    if "search" in name or "context" in name or "lookup" in name:
        return "context_search"
    return "calculator"


def build_toolset(kinds: list[str], task: Task) -> tuple[list[ToolSpec], Callable[[str, dict[str, Any]], str]]:
    unique = [k for i, k in enumerate(kinds) if k in _SPECS and k not in kinds[:i]]
    specs = [_SPECS[k] for k in unique]

    def execute(name: str, args: dict[str, Any]) -> str:
        if name == "calculator" and "calculator" in unique:
            return calculate(str(args.get("expression", "")))
        if name == "context_search" and "context_search" in unique:
            return search_context(task.context, str(args.get("query", "")))
        return f"error: unknown tool {name}"

    return specs, execute

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any


SUPPORTED_OPERATIONS = (
    "add",
    "subtract",
    "multiply",
    "divide",
    "exp",
    "greater",
    "table_sum",
    "table_average",
    "table_max",
    "table_min",
)


@dataclass
class ProgramExecution:
    result: float | bool | None
    error: str | None = None


def extract_program(text: str) -> str | None:
    match = re.search(
        r"(?im)^\s*(?:finqa\s+)?program\s*:\s*`?(.+?)`?\s*$",
        text,
    )
    if not match:
        return None
    program = match.group(1).strip().strip("`")
    # A note after the last operation ("divide(#0, 31.9) (proxy only)") is not part of it.
    program = re.sub(r"\)\s+\([^()]*\)\s*\.?$", ")", program)
    return program or None


def declined(program: str) -> bool:
    """The model wrote no calculation ("none", "n/a ...") because it found no inputs."""
    return bool(re.match(r"^\s*(none|n/?a)", program, re.IGNORECASE))


def strip_program_from_reasoning(reasoning: str | None) -> str | None:
    if not reasoning:
        return reasoning
    cleaned = re.sub(
        r"(?im)^\s*(?:finqa\s+)?program\s*:\s*`?.+?`?\s*$",
        "",
        reasoning,
    )
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned or None


def _split_top_level(text: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    start = 0
    for index, char in enumerate(text):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise ValueError("Unexpected closing parenthesis")
        elif char == "," and depth == 0:
            part = text[start:index].strip()
            if part:
                parts.append(part)
            start = index + 1
    if depth != 0:
        raise ValueError("Unbalanced parentheses")
    final = text[start:].strip()
    if final:
        parts.append(final)
    return parts


_CALL_RE = re.compile(r"([A-Za-z][\w-]*)\s*\((.*)\)", re.DOTALL)


def parse_program(program: str) -> list[tuple[str, list[str]]]:
    """Steps of a FinQA program, in order.

    Models often nest calls, e.g. multiply(divide(465, 7170), const_100). A nested call
    becomes its own step before the one that uses it, and every #n is renumbered, so
    the nested and the flat form of a calculation parse to the same steps.
    """
    top = _split_top_level(program.strip().strip("`"))
    if not top:
        raise ValueError("Program is empty")
    calls: list[tuple[str, list[str]]] = []
    position: dict[int, int] = {}  # a top-level step's #n -> its index once flattened

    def emit(raw_call: str) -> int:
        match = _CALL_RE.fullmatch(raw_call.strip())
        if not match:
            raise ValueError(f"Invalid operation: {raw_call}")
        operation = match.group(1).lower().replace("-", "_")
        if operation not in SUPPORTED_OPERATIONS:
            raise ValueError(f"Unsupported operation: {operation}")
        arguments: list[str] = []
        for part in _split_top_level(match.group(2)):
            part = part.strip()
            if _CALL_RE.fullmatch(part) and not operation.startswith("table_"):
                arguments.append(f"#{emit(part)}")
                continue
            ref = re.fullmatch(r"#(\d+)", part)
            if ref and int(ref.group(1)) in position:
                part = f"#{position[int(ref.group(1))]}"
            arguments.append(part)
        calls.append((operation, arguments))
        return len(calls) - 1

    for index, raw_call in enumerate(top):
        position[index] = emit(raw_call)
    return calls


def is_percent_conversion(call: tuple[str, list[str]]) -> bool:
    """A final ×100, which turns a ratio into a percent without changing the calculation."""
    operation, arguments = call
    return operation == "multiply" and len(arguments) == 2 and "const_100" in [a.strip().lower() for a in arguments]


def normalize_program(program: str) -> str:
    calls = parse_program(program)
    return ",".join(
        f"{operation}({','.join(argument.lower() for argument in arguments)})"
        for operation, arguments in calls
    )


def operation_sequence(program: str) -> list[str]:
    """The operations, ignoring a final ×100 that only expresses the result as a percent."""
    calls = parse_program(program)
    if len(calls) > 1 and is_percent_conversion(calls[-1]):
        calls = calls[:-1]
    return [operation for operation, _ in calls]


def ends_in_percent(program: str) -> bool:
    try:
        calls = parse_program(program)
    except ValueError:
        return False
    return len(calls) > 1 and is_percent_conversion(calls[-1])


def _number(value: str) -> float:
    cleaned = (
        value.strip()
        .lower()
        .replace("−", "-")
        .replace("–", "-")
        .replace("$", "")
        .replace(",", "")
    )
    if cleaned.startswith("const_"):
        constant = cleaned[6:]
        if constant.startswith("m"):
            constant = f"-{constant[1:]}"
        return float(constant)
    if cleaned.endswith("%"):
        return float(cleaned[:-1]) / 100
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = f"-{cleaned[1:-1]}"
    return float(cleaned)


def _cell_number(value: Any) -> float | None:
    text = str(value).strip().replace("−", "-").replace("–", "-")
    if not text or text.lower() in {"none", "n/a", "na", "-", "—"}:
        return None
    matches = re.findall(
        r"[-+]?(?:\(\$?\d[\d,]*(?:\.\d+)?\)|\$?\d[\d,]*(?:\.\d+)?)%?",
        text,
    )
    if not matches:
        return None
    try:
        return _number(matches[0])
    except ValueError:
        return None


def _table_values(table: list[list[Any]], row_name: str) -> list[float]:
    wanted = re.sub(r"\s+", " ", row_name.strip().lower())
    for row in table:
        if not row:
            continue
        label = re.sub(r"\s+", " ", str(row[0]).strip().lower())
        if label != wanted:
            continue
        values = [_cell_number(cell) for cell in row[1:]]
        return [value for value in values if value is not None]
    raise ValueError(f"Table row not found: {row_name}")


def _resolve(argument: str, results: list[float | bool]) -> float | bool:
    reference = re.fullmatch(r"#(\d+)", argument.strip())
    if reference:
        index = int(reference.group(1))
        if index >= len(results):
            raise ValueError(f"Unknown result reference: #{index}")
        return results[index]
    return _number(argument)


def execute_program(
    program: str,
    *,
    table: list[list[Any]] | None = None,
) -> ProgramExecution:
    try:
        calls = parse_program(program)
        results: list[float | bool] = []
        for operation, arguments in calls:
            if operation.startswith("table_"):
                if not arguments:
                    raise ValueError(f"{operation} requires a table row")
                values = _table_values(table or [], arguments[0])
                if not values:
                    raise ValueError(f"No numeric values in table row: {arguments[0]}")
                if operation == "table_sum":
                    result: float | bool = sum(values)
                elif operation == "table_average":
                    result = sum(values) / len(values)
                elif operation == "table_max":
                    result = max(values)
                else:
                    result = min(values)
            else:
                if len(arguments) != 2:
                    raise ValueError(f"{operation} requires two arguments")
                left = _resolve(arguments[0], results)
                right = _resolve(arguments[1], results)
                if isinstance(left, bool) or isinstance(right, bool):
                    raise ValueError("Boolean results cannot be used as numbers")
                if operation == "add":
                    result = left + right
                elif operation == "subtract":
                    result = left - right
                elif operation == "multiply":
                    result = left * right
                elif operation == "divide":
                    if right == 0:
                        raise ValueError("Division by zero")
                    result = left / right
                elif operation == "exp":
                    result = math.pow(left, right)
                else:
                    result = left > right
            results.append(result)
        return ProgramExecution(result=results[-1])
    except (OverflowError, ValueError) as exc:
        return ProgramExecution(result=None, error=str(exc))


def format_result(value: float | bool | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "yes" if value else "no"
    if math.isfinite(value):
        return f"{value:.12g}"
    return str(value)

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
    return program or None


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


def parse_program(program: str) -> list[tuple[str, list[str]]]:
    calls: list[tuple[str, list[str]]] = []
    for raw_call in _split_top_level(program.strip().strip("`")):
        match = re.fullmatch(r"([A-Za-z][\w-]*)\s*\((.*)\)", raw_call)
        if not match:
            raise ValueError(f"Invalid operation: {raw_call}")
        operation = match.group(1).lower().replace("-", "_")
        if operation not in SUPPORTED_OPERATIONS:
            raise ValueError(f"Unsupported operation: {operation}")
        arguments = [part.strip() for part in _split_top_level(match.group(2))]
        calls.append((operation, arguments))
    if not calls:
        raise ValueError("Program is empty")
    return calls


def normalize_program(program: str) -> str:
    calls = parse_program(program)
    return ",".join(
        f"{operation}({','.join(argument.lower() for argument in arguments)})"
        for operation, arguments in calls
    )


def operation_sequence(program: str) -> list[str]:
    return [operation for operation, _ in parse_program(program)]


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

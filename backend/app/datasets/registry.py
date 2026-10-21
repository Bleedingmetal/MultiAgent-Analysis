from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_ROOT = Path(__file__).resolve().parents[2] / "data"


@dataclass
class Task:
    id: str
    benchmark_id: str
    question: str
    expected_answer: str | None
    context: str
    metadata: dict[str, Any]


def _table_to_text(table: list[list[Any]]) -> str:
    lines = []
    for row in table:
        lines.append(" | ".join("" if c is None else str(c) for c in row))
    return "\n".join(lines)


def _truncate_middle(text: str, limit: int) -> str:
    """Keep evidence from both ends instead of dropping the end entirely."""
    if len(text) <= limit:
        return text
    marker = " … "
    side = (limit - len(marker)) // 2
    return f"{text[:side]}{marker}{text[-side:]}"


def _load_finqa_raw() -> list[dict[str, Any]]:
    full = DATA_ROOT / "finqa" / "test.json"
    sample = DATA_ROOT / "finqa" / "sample20.json"
    path = full if full.exists() else sample
    if not path.exists():
        raise FileNotFoundError(
            "FinQA data missing. Run: python backend/scripts/fetch_extra_datasets.py "
            "(and ensure finqa/test.json or sample20.json exists)."
        )
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _finqa_task(item: dict[str, Any], index: int) -> Task:
    qa = item.get("qa") or {}
    question = qa.get("question") or ""
    expected = qa.get("exe_ans")
    if expected is None:
        expected = qa.get("answer")
    expected_s = None if expected is None else str(expected)

    pre = _truncate_middle(" ".join(item.get("pre_text") or []), 1400)
    post = _truncate_middle(" ".join(item.get("post_text") or []), 1400)
    table = _truncate_middle(_table_to_text(item.get("table") or []), 2500)
    context = (
        f"Pre-text:\n{pre}\n\nTable:\n{table}\n\nPost-text:\n{post}"
    ).strip()

    tid = str(item.get("id") or f"finqa-{index:04d}")
    return Task(
        id=tid,
        benchmark_id="finqa",
        question=question,
        expected_answer=expected_s,
        context=context,
        metadata={
            "program": qa.get("program"),
            "answer_text": qa.get("answer"),
        },
    )


def _load_tau_raw() -> list[dict[str, Any]]:
    path = DATA_ROOT / "tau_bench" / "retail_sample.json"
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _tau_task(item: dict[str, Any]) -> Task:
    return Task(
        id=item["id"],
        benchmark_id="tau-retail",
        question=item["instruction"],
        expected_answer=None,
        context=(
            "You are a retail customer-service agent with tools for users, orders, "
            "and products. Describe the tool calls and final resolution you would take. "
            f"User id: {item.get('user_id', 'unknown')}."
        ),
        metadata={"user_id": item.get("user_id")},
    )


def _load_fab_raw() -> list[dict[str, Any]]:
    csv_path = DATA_ROOT / "fab" / "public.csv"
    sample = DATA_ROOT / "fab" / "sample20.json"
    if csv_path.exists():
        with csv_path.open(encoding="utf-8") as f:
            return list(csv.DictReader(f))
    if sample.exists():
        with sample.open(encoding="utf-8") as f:
            return json.load(f)
    return []


def _fab_task(item: dict[str, Any], index: int) -> Task:
    q = item.get("Question") or item.get("question") or ""
    a = item.get("Answer") or item.get("answer")
    qtype = item.get("Question Type") or item.get("type")
    return Task(
        id=f"fab-{index:03d}",
        benchmark_id="fab",
        question=q,
        expected_answer=str(a) if a else None,
        context=(
            "You are a finance research agent with access to SEC filings and web sources. "
            f"Question type: {qtype or 'unknown'}. "
            "Answer concisely with the key facts. If uncertain, say what filing you would check."
        ),
        metadata={
            "question_type": qtype,
            "rubric": item.get("Rubric"),
        },
    )


DATASET_SYSTEM_PROMPTS: dict[str, str] = {
    "finqa": (
        "You are a financial question-answering assistant. "
        "Use only the provided table and surrounding text. "
        "Do not invent figures. For numeric questions, put the final answer alone on the last line. "
        "For yes/no questions, answer yes or no clearly."
    ),
    "tau-retail": (
        "You are a retail customer-service agent with access to user, order, and product tools. "
        "Given the customer request, describe the concrete tool calls and final resolution. "
        "Stay concise and actionable."
    ),
    "fab": (
        "You are a finance research analyst answering questions grounded in SEC filings and public company disclosures. "
        "State the key facts clearly. If evidence would require a specific filing, name what you would check. "
        "Keep the final answer concise."
    ),
}


def system_prompt_for(benchmark_id: str) -> str:
    return DATASET_SYSTEM_PROMPTS.get(
        benchmark_id,
        "You are a careful assistant. Answer clearly and put the final answer on the last line.",
    )


@lru_cache
def list_benchmarks() -> list[dict[str, Any]]:
    finqa_n = len(_load_finqa_raw())
    tau_n = len(_load_tau_raw())
    fab_n = len(_load_fab_raw())
    rows = [
        {
            "id": "finqa",
            "name": "FinQA",
            "structure": "Deterministic, decomposable",
            "role": "Cheap scored cell",
            "task_count": finqa_n,
            "scored": True,
            "available": finqa_n > 0,
            "default_system_prompt": system_prompt_for("finqa"),
            "notes": "Numeric/exe answers from FinQA public test set.",
        },
        {
            "id": "tau-retail",
            "name": "tau-bench Retail",
            "structure": "Sequential, shared-state",
            "role": "Fidelity anchor (stub)",
            "task_count": tau_n,
            "scored": False,
            "available": tau_n > 0,
            "default_system_prompt": system_prompt_for("tau-retail"),
            "notes": "Sample retail instructions only. Full tool+user sim comes later.",
        },
        {
            "id": "fab",
            "name": "Finance Agent Benchmark",
            "structure": "Breadth-first research",
            "role": "Research cell",
            "task_count": fab_n,
            "scored": False,
            "available": fab_n > 0,
            "default_system_prompt": system_prompt_for("fab"),
            "notes": "vals-ai public validation questions. Open-ended; success not auto-scored yet.",
        },
    ]
    return [r for r in rows if r["available"]]


def list_tasks(benchmark_id: str, limit: int = 20) -> list[Task]:
    if benchmark_id == "finqa":
        return [_finqa_task(x, i) for i, x in enumerate(_load_finqa_raw()[:limit])]
    if benchmark_id == "tau-retail":
        return [_tau_task(x) for x in _load_tau_raw()[:limit]]
    if benchmark_id == "fab":
        return [_fab_task(x, i) for i, x in enumerate(_load_fab_raw()[:limit])]
    raise KeyError(f"Unknown benchmark: {benchmark_id}")


def get_task(benchmark_id: str, task_id: str | None = None) -> Task:
    if benchmark_id == "finqa":
        raw = _load_finqa_raw()
        if not raw:
            raise KeyError("No FinQA tasks available")
        if task_id is None:
            return _finqa_task(raw[0], 0)
        for i, item in enumerate(raw):
            tid = str(item.get("id") or f"finqa-{i:04d}")
            if tid == task_id or f"finqa-{i:04d}" == task_id:
                return _finqa_task(item, i)
        raise KeyError(f"Task {task_id} not found in finqa")

    tasks = list_tasks(benchmark_id, limit=50)
    if not tasks:
        raise KeyError(f"No tasks for benchmark {benchmark_id}")
    if task_id is None:
        return tasks[0]
    for t in tasks:
        if t.id == task_id:
            return t
    raise KeyError(f"Task {task_id} not found in {benchmark_id}")


def normalize_answer(value: str) -> str:
    s = value.strip().lower()
    s = s.replace(",", "")
    s = re.sub(r"\s+", " ", s)
    if s.endswith("%"):
        try:
            return str(float(s[:-1]) / 100)
        except ValueError:
            return s
    try:
        return str(float(s))
    except ValueError:
        return s


def score_answer(expected: str | None, actual: str) -> bool | None:
    if expected is None:
        return None
    exp = normalize_answer(str(expected))
    act = normalize_answer(actual)
    if exp == act:
        return True
    # allow answer buried in model prose
    if exp and exp in act:
        return True
    # numeric tolerance
    try:
        return abs(float(exp) - float(act)) <= max(1e-4, abs(float(exp)) * 0.01)
    except ValueError:
        pass

    # Models often include units or prose around a correct FinQA number.
    # Compare each number in the response, including percentage conversion.
    for match in re.finditer(r"[-+]?\$?[\d,]*\.?\d+\s*%?", actual):
        token = match.group().strip().replace("$", "").replace(",", "")
        is_percent = token.endswith("%")
        if is_percent:
            token = token[:-1].strip()
        try:
            candidate = float(token)
            if is_percent:
                candidate /= 100
            expected_number = float(exp)
        except ValueError:
            continue
        tolerance = max(1e-4, abs(expected_number) * 0.01)
        if abs(expected_number - candidate) <= tolerance:
            return True
    return False

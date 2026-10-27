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
    # Human-facing label for UI (units); scoring still uses expected_answer.
    expected_display: str | None = None


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


def _infer_money_scale(*texts: str) -> str | None:
    blob = " ".join(t for t in texts if t).lower()
    if re.search(r"\bin billions?\b|\(\s*in billions", blob):
        return "billion"
    if re.search(r"\bin millions?\b|\(\s*in millions", blob):
        return "million"
    if re.search(r"\bin thousands?\b|\(\s*in thousands", blob):
        return "thousand"
    return None


def humanize_expected(
    exe_ans: str | None,
    *,
    answer_text: str | None = None,
    unit_scale: str | None = None,
) -> str | None:
    """
    User-facing expected label. Scoring still uses exe_ans.
    Only adds units when FinQA evidence makes them clear — no guessing.
    """
    if exe_ans is None:
        return None
    text = (answer_text or "").strip()
    if text and "%" in text:
        return text

    try:
        number = float(str(exe_ans).replace(",", ""))
    except ValueError:
        return text or str(exe_ans)

    if text and re.fullmatch(r"[-+]?\d*\.?\d+\s*%", text.replace(",", "")):
        return text

    if unit_scale in {"thousand", "million", "billion"}:
        if abs(number - round(number)) < 1e-6 and abs(number) >= 1:
            pretty = str(int(round(number)))
        else:
            pretty = f"{number:g}"
        return f"${pretty} {unit_scale}"

    return text or str(exe_ans)


def _finqa_task(item: dict[str, Any], index: int) -> Task:
    qa = item.get("qa") or {}
    question = qa.get("question") or ""
    expected = qa.get("exe_ans")
    if expected is None:
        expected = qa.get("answer")
    expected_s = None if expected is None else str(expected)
    answer_text = qa.get("answer")
    gold_blob = " ".join((qa.get("gold_inds") or {}).values())
    pre_join = " ".join(item.get("pre_text") or [])
    unit_scale = _infer_money_scale(gold_blob, pre_join)
    expected_display = humanize_expected(
        expected_s, answer_text=str(answer_text) if answer_text else None, unit_scale=unit_scale
    )

    pre = _truncate_middle(pre_join, 1400)
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
        expected_display=expected_display,
        context=context,
        metadata={
            "program": qa.get("program"),
            "answer_text": answer_text,
            "unit_scale": unit_scale,
            "expected_display": expected_display,
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
        "Use only the provided table and surrounding text. Do not invent figures. "
        "Respond in two parts:\n"
        "Reasoning: short step-by-step using the evidence (figures and units).\n"
        "Final answer: one quantity alone — bare number (e.g. 94), percentage (e.g. 6.76%), "
        "or currency with scale (e.g. $94 million). "
        "Do not invent units. For yes/no, put yes or no as the Final answer."
    ),
    "tau-retail": (
        "You are a retail customer-service agent with access to user, order, and product tools. "
        "Respond in two parts:\n"
        "Reasoning: which tools and steps you would take.\n"
        "Final answer: the concrete resolution."
    ),
    "fab": (
        "You are a finance research analyst answering questions grounded in SEC filings and public company disclosures. "
        "Respond in two parts:\n"
        "Reasoning: key facts and what filings you would check.\n"
        "Final answer: the concise conclusion."
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


# FinQA exe_ans is the program result in table units. Unit words are whitelist-only.
_SCALE_WORDS: dict[str, float] = {
    "thousand": 1e3,
    "thousands": 1e3,
    "k": 1e3,
    "million": 1e6,
    "millions": 1e6,
    "m": 1e6,
    "mm": 1e6,
    "billion": 1e9,
    "billions": 1e9,
    "b": 1e9,
    "bn": 1e9,
}
_TABLE_UNIT_SCALES = (1e3, 1e6, 1e9)
_YES_NO = {"yes", "no", "true", "false"}

# Final span: number, optional $, optional % / scale word. Reject unknown unit tails.
_QUANTITY_RE = re.compile(
    r"""
    ^\s*
    (?P<sign>[-+])?
    \s*
    (?P<currency>\$)?
    \s*
    (?P<number>\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d*\.\d+|\d+)
    \s*
    (?P<percent>%)?
    \s*
    (?P<scale>thousand|thousands|million|millions|billion|billions|mm|bn|[kmb])?
    \s*
    (?:of\s+)?(?:dollars?|usd)?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)


def normalize_answer(value: str) -> str:
    """Legacy helper for simple string forms; scoring uses parse_final_quantity."""
    s = value.strip().lower().replace(",", "")
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


def _numeric_match(expected: float, candidate: float) -> bool:
    tolerance = max(1e-4, abs(expected) * 0.01)
    return abs(expected - candidate) <= tolerance


def split_reasoning_and_answer(text: str) -> tuple[str | None, str]:
    """
    Split model output into (reasoning, final_answer_span).
    Prefers explicit Reasoning: / Final answer: sections for auditability.
    """
    raw = text.strip()
    if not raw:
        return None, ""

    sectioned = re.search(
        r"(?is)^\s*(?:reasoning|thought\s*process|scratch\s*work)\s*:\s*(.*?)\n\s*"
        r"(?:final\s*answer|answer)\s*:\s*(.+)\s*$",
        raw,
    )
    if sectioned:
        reasoning = sectioned.group(1).strip() or None
        final_block = sectioned.group(2).strip()
        final_line = final_block.splitlines()[-1].strip().rstrip(".")
        return reasoning, final_line

    marked = list(
        re.finditer(r"(?im)^(?:final\s*answer|answer)\s*:\s*(.+)\s*$", raw)
    )
    if marked:
        last = marked[-1]
        final = last.group(1).strip().rstrip(".")
        before = raw[: last.start()].strip()
        before = re.sub(
            r"(?im)^\s*(?:reasoning|thought\s*process|scratch\s*work)\s*:\s*",
            "",
            before,
        ).strip()
        return before or None, final

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if len(lines) == 1:
        return None, lines[0].rstrip(".")
    return "\n".join(lines[:-1]), lines[-1].rstrip(".")


def final_answer_span(text: str) -> str:
    """Score only the committed final answer, not numbers inside scratch work."""
    _, final = split_reasoning_and_answer(text)
    return final


@dataclass(frozen=True)
class ParsedQuantity:
    value: float
    scale: float = 1.0
    is_percent: bool = False
    is_currency: bool = False
    is_yes_no: bool = False
    yes_no: str | None = None


def parse_final_quantity(span: str) -> ParsedQuantity | None:
    s = span.strip().lower()
    s = s.replace(",", "")
    s = re.sub(r"\s+", " ", s)
    if not s:
        return None

    if s in _YES_NO:
        return ParsedQuantity(
            value=1.0 if s in {"yes", "true"} else 0.0,
            is_yes_no=True,
            yes_no="yes" if s in {"yes", "true"} else "no",
        )

    match = _QUANTITY_RE.match(s)
    if not match:
        return None

    number_raw = match.group("number")
    try:
        value = float(number_raw)
    except ValueError:
        return None
    if match.group("sign") == "-":
        value = -value

    is_percent = bool(match.group("percent"))
    scale_word = (match.group("scale") or "").lower()
    scale = _SCALE_WORDS.get(scale_word, 1.0)
    if is_percent and scale != 1.0:
        return None
    return ParsedQuantity(
        value=value,
        scale=scale,
        is_percent=is_percent,
        is_currency=bool(match.group("currency")) or bool(scale_word),
    )


def _candidate_values(parsed: ParsedQuantity) -> list[float]:
    """Map a stated quantity onto FinQA exe_ans space (ratio or table units)."""
    if parsed.is_yes_no:
        return [parsed.value]

    if parsed.is_percent:
        # Accept either 6.76% or the ratio form 0.0676
        return [parsed.value / 100.0, parsed.value]

    value = parsed.value
    out = [value]
    if parsed.scale != 1.0:
        absolute = value * parsed.scale
        out.append(absolute)
        for unit in _TABLE_UNIT_SCALES:
            out.append(absolute / unit)
    else:
        # Full dollar amounts vs table units (e.g. 94000000 vs 94 in millions)
        for unit in _TABLE_UNIT_SCALES:
            if abs(value) >= unit / 10:
                out.append(value / unit)
    # de-dupe preserving order
    seen: set[float] = set()
    uniq: list[float] = []
    for item in out:
        key = round(item, 10)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(item)
    return uniq


def score_answer(expected: str | None, actual: str) -> bool | None:
    """
    Honest FinQA compare:
    - only the final-answer span (last line / 'Answer:')
    - whitelist units ($ / % / thousand|million|billion)
    - unknown unit tails fail (no '94 potatoes')
    - no hunting for a matching number inside reasoning prose
    """
    if expected is None:
        return None

    expected_span = str(expected).strip()
    expected_parsed = parse_final_quantity(expected_span)
    if expected_parsed is None:
        # Non-numeric gold: exact normalized string on final span only
        return final_answer_span(actual).strip().lower() == expected_span.lower()

    if expected_parsed.is_yes_no:
        got = parse_final_quantity(final_answer_span(actual))
        return bool(got and got.is_yes_no and got.yes_no == expected_parsed.yes_no)

    span = final_answer_span(actual)
    got = parse_final_quantity(span)
    if got is None or got.is_yes_no:
        return False

    expected_number = expected_parsed.value
    return any(
        _numeric_match(expected_number, candidate)
        for candidate in _candidate_values(got)
    )

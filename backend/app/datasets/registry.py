from __future__ import annotations

import csv
import json
import random
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
    steps = qa.get("steps") or []
    final_step_result = str(steps[-1].get("res") or "") if steps else ""
    expected_is_percent = "%" in str(answer_text or "") or "%" in final_step_result
    display_answer = str(answer_text) if answer_text else final_step_result or None
    gold_blob = " ".join((qa.get("gold_inds") or {}).values())
    model_input = qa.get("model_input") or []
    expected_evidence = [
        str(entry[1])
        for entry in model_input
        if isinstance(entry, (list, tuple)) and len(entry) >= 2
    ]
    if not expected_evidence:
        expected_evidence = list((qa.get("gold_inds") or {}).values())
    pre_join = " ".join(item.get("pre_text") or [])
    unit_scale = _infer_money_scale(gold_blob, pre_join)
    expected_display = humanize_expected(
        expected_s,
        answer_text=display_answer,
        unit_scale=unit_scale,
    )

    # Programs ending in multiply(..., const_100) produce a percentage (26.07), not a ratio.
    program = str(qa.get("program") or "")
    percent_units = bool(
        re.search(r"multiply\([^)]*const_100|divide\(const_100", program)
    )
    # FinQA sometimes contradicts itself: its written answer or its annotated final step
    # disagrees with the executed gold program (e.g. a "subtract" where "divide" was
    # meant). Keep those as accepted alternate answers and flag the label as disputed.
    alternate_answers: list[str] = []
    for candidate in (str(answer_text or "").strip(), final_step_result.strip()):
        if not candidate or expected_s is None or candidate in alternate_answers:
            continue
        if parse_final_quantity(candidate) is None:
            continue
        consistent = score_answer(
            expected_s,
            f"Final answer: {candidate}",
            expected_is_percent=expected_is_percent,
            expected_in_percent_units=percent_units,
        )
        if consistent is False:
            alternate_answers.append(candidate)
    if alternate_answers:
        shown = [expected_display or ""] + [a for a in alternate_answers if a != expected_display]
        expected_display = " or ".join(x for x in shown if x)

    # The filing is sent whole. Cutting the middle of long passages removed the very
    # sentence some questions depend on (IP/2006/page_30.pdf-2 lost its $465 million).
    pre = pre_join
    post = " ".join(item.get("post_text") or [])
    table = _table_to_text(item.get("table") or [])
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
            "program_re": qa.get("program_re"),
            "steps": steps,
            "expected_evidence": expected_evidence,
            "table": item.get("table") or [],
            "answer_text": answer_text,
            "expected_is_percent": expected_is_percent,
            "expected_in_percent_units": percent_units,
            "alternate_answers": alternate_answers,
            "unit_scale": unit_scale,
            "expected_display": expected_display,
        },
    )


@lru_cache
def _tau_tasks() -> list[Task]:
    """tau-bench (original) retail test tasks, from the official tau_bench package."""
    try:
        from app.benchmarks.tau_retail import harness_task, tau_tasks
    except Exception:
        return []
    return [harness_task(i, t) for i, t in enumerate(tau_tasks())]


@lru_cache
def _tau2_tasks() -> list[Task]:
    """tau2-bench retail tasks, from the official tau2 package plus its downloaded data."""
    if not (DATA_ROOT / "tau2" / "domains" / "retail" / "tasks.json").exists():
        return []
    try:
        from app.benchmarks.tau2_retail import harness_task, tau_tasks
    except Exception:
        return []
    return [harness_task(t) for t in tau_tasks()]


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


_TAU_PROMPT = (
    "You are a retail customer-service agent. Follow the store policy you are given, "
    "look everything up with the tools, and act only when the customer confirms."
)

DATASET_SYSTEM_PROMPTS: dict[str, str] = {
    "finqa": (
        "You are a financial question-answering assistant. "
        "Use only the provided table and surrounding text. Do not invent figures. "
        "Produce a concise, auditable calculation using the FinQA DSL. "
        "Supported operations are add, subtract, multiply, divide, exp, greater, "
        "table_sum, table_average, table_max, and table_min. "
        "Write the numbers themselves into the program, as they appear in the evidence. "
        "#0, #1 and so on refer only to the result of an earlier operation in the same "
        "program (#0 is the first), never to a figure; use constants such as const_100 "
        "when needed, one operation per step, not nested. "
        # The reply layout (Reasoning / Program / Final answer) is sent once, by
        # response_format_for, with every call that writes the final answer.
        "The Final answer is one quantity alone. "
        "A FinQA decimal ratio may be presented as its equivalent percentage "
        "(for example, 0.0676 and 6.76% are equivalent). Preserve negative and positive signs. "
        "Do not invent units. For yes/no, put yes or no as the Final answer."
    ),
    "tau-retail": _TAU_PROMPT,
    "tau2-retail": _TAU_PROMPT,
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


# Reasoning as numbered steps so the UI can show the train of thought step by step.
_FINQA_RESPONSE_FORMAT = (
    "Reply in this format:\n"
    "Reasoning:\n"
    "1. <the figures you took from the evidence, with their units>\n"
    "2. <the formula, in plain words>\n"
    "3. <the arithmetic, e.g. (101.88 - 93.21) / 93.21 = 0.093>\n"
    "(2-5 short numbered steps, each on its own line)\n"
    "Program: <one line of comma-separated FinQA operations with the actual numbers, "
    "e.g. divide(465, 7170), multiply(#0, const_100)>\n"
    "Final answer: <bare number, percentage like 6.76%, or $94 million>"
)
_DEFAULT_RESPONSE_FORMAT = (
    "Reply in this format:\n"
    "Reasoning:\n"
    "1. <first step of your thinking>\n"
    "2. <next step>\n"
    "(2-5 short numbered steps, each on its own line)\n"
    "Final answer: <your answer>"
)


def response_format_for(benchmark_id: str) -> str:
    """Answer layout the scorer expects from the agent that produces the final answer."""
    return _FINQA_RESPONSE_FORMAT if benchmark_id == "finqa" else _DEFAULT_RESPONSE_FORMAT


def reload() -> None:
    """Forget cached dataset files (after a download)."""
    for obj in list(globals().values()):
        clear = getattr(obj, "cache_clear", None)
        if callable(clear):
            clear()


def list_benchmarks(include_missing: bool = False) -> list[dict[str, Any]]:
    rows = _all_benchmarks()
    return list(rows) if include_missing else [r for r in rows if r["available"]]


@lru_cache
def _all_benchmarks() -> list[dict[str, Any]]:
    finqa_n = len(_load_finqa_raw())
    tau_n = len(_tau_tasks())
    tau2_n = len(_tau2_tasks())
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
            "name": "τ-bench Retail",
            "structure": "Multi-turn, tool-using conversation",
            "role": "Fidelity anchor",
            "task_count": tau_n,
            "scored": True,
            "available": tau_n > 0,
            "default_system_prompt": system_prompt_for("tau-retail"),
            "notes": "Original tau-bench retail test split: real tools, LLM customer, graded on final database state and required outputs.",
        },
        {
            "id": "tau2-retail",
            "name": "τ²-bench Retail",
            "structure": "Multi-turn, tool-using conversation",
            "role": "Fidelity anchor (successor)",
            "task_count": tau2_n,
            "scored": True,
            "available": tau2_n > 0,
            "default_system_prompt": system_prompt_for("tau2-retail"),
            "notes": "tau2-bench retail: the same domain with cleaned tasks, reference-action checks and natural-language assertions judged by an LLM.",
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
    return rows


def _matches(task: Task, query: str) -> bool:
    """Every word of the query appears in the task, allowing a small misspelling ("brazillian")."""
    from difflib import SequenceMatcher

    haystack = " ".join(
        str(x or "") for x in (task.id, task.question, task.expected_answer, task.expected_display)
    ).lower()
    words = re.findall(r"[\w.%$]+", haystack)
    for term in re.findall(r"[\w.%$]+", query.lower()):
        if term in haystack:
            continue
        if len(term) >= 5 and any(
            abs(len(w) - len(term)) <= 2 and SequenceMatcher(None, term, w).ratio() >= 0.85 for w in words
        ):
            continue
        return False
    return True


def search_tasks(benchmark_id: str, query: str, limit: int = 50) -> list[Task]:
    """Tasks whose id, question or answer match `query`, searched across the whole benchmark."""
    if benchmark_id == "finqa":
        pool = [_finqa_task(x, i) for i, x in enumerate(_load_finqa_raw())]
    else:
        pool = list_tasks(benchmark_id, limit=100_000)
    return [t for t in pool if _matches(t, query)][:limit]


def list_tasks(benchmark_id: str, limit: int = 20) -> list[Task]:
    if benchmark_id == "finqa":
        return [_finqa_task(x, i) for i, x in enumerate(_load_finqa_raw()[:limit])]
    if benchmark_id == "tau-retail":
        return _tau_tasks()[:limit]
    if benchmark_id == "tau2-retail":
        return _tau2_tasks()[:limit]
    if benchmark_id == "fab":
        return [_fab_task(x, i) for i, x in enumerate(_load_fab_raw()[:limit])]
    raise KeyError(f"Unknown benchmark: {benchmark_id}")


# Fixed so every configuration is evaluated on the same questions.
SAMPLE_SEED = 20260
# Benchmarks with an automatic pass/fail scorer (end-to-end runs need one).
SCORED_BENCHMARKS = {"finqa", "tau-retail", "tau2-retail"}


def task_count(benchmark_id: str) -> int:
    if benchmark_id == "finqa":
        return len(_load_finqa_raw())
    if benchmark_id == "tau-retail":
        return len(_tau_tasks())
    if benchmark_id == "tau2-retail":
        return len(_tau2_tasks())
    if benchmark_id == "fab":
        return len(_load_fab_raw())
    raise KeyError(f"Unknown benchmark: {benchmark_id}")


def sample_tasks(benchmark_id: str, size: int | None = None) -> list[Task]:
    """A deterministic sample: one fixed shuffle of the whole dataset, first `size` items.

    Samples are nested (the first 25 of a 50-question run are the 25-question run), and
    identical across configurations, so results are directly comparable.
    """
    total = task_count(benchmark_id)
    order = list(range(total))
    random.Random(f"{benchmark_id}:{SAMPLE_SEED}").shuffle(order)
    picked = order if size is None else order[: max(0, min(size, total))]
    tasks = list_tasks(benchmark_id, limit=total)
    return [tasks[i] for i in picked]


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

    tasks = list_tasks(benchmark_id, limit=10_000)
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
_RELATIVE_TOLERANCE = 0.01
_ABSOLUTE_TOLERANCE = 1e-4

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
    tolerance = max(_ABSOLUTE_TOLERANCE, abs(expected) * _RELATIVE_TOLERANCE)
    return abs(expected - candidate) <= tolerance


def split_reasoning_and_answer(text: str) -> tuple[str | None, str]:
    """
    Split model output into (reasoning, final_answer_span).
    Prefers explicit Reasoning: / Final answer: sections for auditability.
    """
    # Strip markdown emphasis/headings (Claude often writes "**Final answer:** 94")
    raw = re.sub(r"\*\*|__", "", text)
    raw = re.sub(r"(?m)^\s*#+\s*", "", raw).strip()
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
    decimal_places: int = 0
    is_yes_no: bool = False
    yes_no: str | None = None


_HEDGE_RE = re.compile(r"^(?:approximately|approx\.?|about|around|roughly|nearly|~|≈)\s*", re.IGNORECASE)
# "(in thousands)", "(thousands)", "(in $ millions)": a unit written in brackets after the number
_BRACKET_UNIT_RE = re.compile(
    r"\s*\(\s*(?:in\s+)?(?:\$\s*|usd\s+)?(thousands?|millions?|billions?)(?:\s+of\s+dollars)?\s*\)\s*$",
    re.IGNORECASE,
)
# digits grouped with spaces or thin spaces: "338 928" or "1 016 784"
_SPACED_DIGITS_RE = re.compile(r"(?<![\d.])(\d{1,3})((?:[   ]\d{3})+)(?![\d])")


def _tidy_span(span: str) -> str:
    """Normalise how a number is written, without changing which number it is."""
    s = span.strip()
    s = _HEDGE_RE.sub("", s)
    s = _BRACKET_UNIT_RE.sub(lambda m: " " + m.group(1), s)
    # A note in brackets after the number ("$338,928 thousand (≈ $338.9 million)") is
    # dropped, unless the whole answer is bracketed, which is an accounting negative.
    if not (s.startswith("(") and s.endswith(")")):
        s = re.sub(r"\s*\([^()]*\)\s*$", "", s)
    s = _SPACED_DIGITS_RE.sub(lambda m: m.group(1) + re.sub(r"[   ]", "", m.group(2)), s)
    return s


def parse_final_quantity(span: str) -> ParsedQuantity | None:
    s = _tidy_span(span).lower()
    s = s.replace("−", "-").replace("–", "-")
    s = s.replace(",", "")
    s = re.sub(r"\s+", " ", s)
    if not s:
        return None

    accounting_negative = s.startswith("(") and s.endswith(")")
    if accounting_negative:
        s = s[1:-1].strip()
        if s.startswith(("+", "-")):
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
    if accounting_negative:
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
        decimal_places=(
            len(number_raw.rsplit(".", 1)[1]) if "." in number_raw else 0
        ),
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


def _percentage_match(
    expected_value: float, got: ParsedQuantity, *, percent_units: bool = False
) -> bool:
    """`expected_value` is a ratio (0.0676), or already a percent (6.76) with percent_units."""
    expected_ratio = expected_value / 100 if percent_units else expected_value
    if got.is_percent:
        # Respect the precision the agent committed to. For example, FinQA's
        # 0.14464 is equivalent to 14%, 14.5%, or 14.464% at those precisions.
        expected_percent = expected_ratio * 100
        rounded_expected = round(expected_percent, got.decimal_places)
        rounding_slack = 10 ** (-(got.decimal_places + 4))
        if abs(rounded_expected - got.value) <= rounding_slack:
            return True
        # Same relative tolerance as every other numeric answer, so a last-digit
        # rounding slip (9.31% for 9.302%) is not scored as a wrong answer.
        return _numeric_match(expected_percent, got.value)
    if got.scale != 1.0:
        return False
    if _numeric_match(expected_ratio, got.value):
        return True
    # A bare number in the program's own percent units ("2.5" for 2.5 percent).
    if percent_units and _numeric_match(expected_value, got.value):
        return True
    # A ratio rounded to the precision given ("0.41" for 0.41467).
    if got.decimal_places >= 2:
        rounded = round(expected_ratio, got.decimal_places)
        return abs(rounded - got.value) <= 10 ** (-(got.decimal_places + 4))
    return False


def score_answer(
    expected: str | None,
    actual: str,
    *,
    expected_is_percent: bool | None = None,
    expected_in_percent_units: bool = False,
) -> bool | None:
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
    if expected_is_percent is True:
        return _percentage_match(
            expected_number, got, percent_units=expected_in_percent_units
        )
    if expected_is_percent is False and got.is_percent:
        # FinQA's gold has no % sign, but a model may state the same quantity as a
        # percent: "15.41%" for the ratio 0.15413, or "105%" for a change of 105.
        # Accept it when either reading matches the gold within the usual tolerance;
        # never combine a % with a scale word.
        return got.scale == 1.0 and any(
            _numeric_match(expected_number, candidate)
            for candidate in (got.value / 100.0, got.value)
        )
    return any(
        _numeric_match(expected_number, candidate)
        for candidate in _candidate_values(got)
    )

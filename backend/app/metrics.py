"""Reliability (pass^k) and consistency over repeated executions of the same task.

Both metrics look across every stored execution of a task under the same conditions:
the same benchmark, configuration, mode, models, configuration contents and system
prompt. Executions are pooled across end-to-end runs and single runs, so three single-
pass runs of one configuration give each task three attempts. Nothing here calls a
model: success comes from the benchmark's own grader (already stored on each run), and
consistency compares what the runs produced and did.

Reliability, pass^k (Yao et al. 2024, τ-bench):
    pass^k = (1/N) Σ_i C(c_i, k) / C(n_i, k)
over the N tasks with at least k scored attempts; c_i of the n_i attempts succeeded.
Each task counts once however many attempts it has. Fewer than k attempts: N/A.

Consistency = 0.70 × output consistency + 0.30 × execution consistency (the weights are
this project's choice, not a published standard).

Output consistency (Raj et al. 2026, Eq. 1): for one task with n outputs,
    U = C(n, 2)^-1 Σ_{i<j} k(y_i, y_j)
with k(y, y') = 1 when the two outputs are equivalent and 0 otherwise. FinQA outputs are
the parsed final quantity (6.49% and 0.0649 are equivalent, within the grader's 1%
tolerance); τ-bench outputs are the set of changes the conversation made to the store's
database. Pass/fail is never used as the output.

Execution consistency (Yagubyan 2026, "How Consistent Are LLM Agents?", Defs. 3-4):
    TSS = mean over pairs of 1 - Lev(s, s') / max(|s|, |s'|)    (tool-name sequences)
    AC  = mean over step-aligned calls of |f(c) ∩ f(c')| / |f(c) ∪ f(c')|, 0 when the
          tools differ                                         (key-value arguments)
    execution = (TSS + AC) / 2 for a pair, or TSS alone when no calls align.
τ-bench's path is its tool calls; FinQA's is the operations of the model's program.
Reasoning text and the configuration's fixed node layout are not compared.

Task scores are averaged without weights into a configuration score (Raj et al. Eq. 3).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any

from app.datasets.finqa_program import extract_program, parse_program, is_percent_conversion
from app.datasets.registry import (
    _candidate_values,
    _numeric_match,
    final_answer_span,
    parse_final_quantity,
)
from app.schemas import RunResult

OUTPUT_WEIGHT = 0.70
EXECUTION_WEIGHT = 0.30
DEFAULT_K = 3
BENCHMARKS = {"finqa", "tau-retail", "tau2-retail"}

_DECLINED = re.compile(r"(not\s+determinable|cannot\s+be\s+determined|can't\s+be\s+determined|insufficient|^n/?a\b|^none\b)", re.I)


# ---- grouping ---------------------------------------------------------------------


def _digest(value: Any) -> str:
    return hashlib.sha1(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:10]


def condition_key(run: RunResult) -> tuple:
    """Executions with the same key ran under the same conditions and can be compared."""
    config = run.configuration.model_dump() if run.configuration else {}
    layout = {k: config.get(k) for k in ("architecture", "nodes", "edges", "layers")}
    first = run.steps[0] if run.steps else None
    system_prompt = getattr(first, "system_prompt", None) or run.system_prompt or ""
    return (
        run.benchmark_id,
        run.configuration_id,
        run.mode,
        run.model,
        _digest(layout),
        _digest(system_prompt),
    )


@dataclass
class Group:
    key: tuple
    configuration_id: str
    configuration_name: str
    architecture: str
    benchmark_id: str
    mode: str
    models: str
    runs: dict[str, list[RunResult]] = field(default_factory=lambda: defaultdict(list))


def group_runs(runs: list[RunResult]) -> list[Group]:
    groups: dict[tuple, Group] = {}
    for run in runs:
        if run.benchmark_id not in BENCHMARKS or run.status != "completed":
            continue
        key = condition_key(run)
        group = groups.get(key)
        if group is None:
            group = groups[key] = Group(
                key=key, configuration_id=run.configuration_id, configuration_name=run.configuration_name,
                architecture=run.architecture, benchmark_id=run.benchmark_id, mode=run.mode, models=run.model,
            )
        group.runs[run.task_id].append(run)
    return list(groups.values())


# ---- reliability ------------------------------------------------------------------


def pass_hat_k(successes: int, attempts: int, k: int) -> float | None:
    """Probability that k attempts drawn without replacement all succeed; None if attempts < k."""
    if attempts < k or k < 1:
        return None
    return math.comb(successes, k) / math.comb(attempts, k)


def reliability(group: Group, k: int) -> dict[str, Any]:
    per_task = []
    for runs in group.runs.values():
        scored = [r.success for r in runs if r.success is not None]
        value = pass_hat_k(sum(scored), len(scored), k)
        if value is not None:
            per_task.append(value)
    return {
        "k": k,
        "value": sum(per_task) / len(per_task) if per_task else None,
        "eligible_tasks": len(per_task),
    }


# ---- output consistency -------------------------------------------------------------


def finqa_output(run: RunResult) -> tuple:
    """The final answer, normalised: a quantity, yes/no, a refusal, or the text itself."""
    span = final_answer_span(run.answer or "")
    parsed = parse_final_quantity(span)
    if parsed is not None and parsed.is_yes_no:
        return ("yes_no", parsed.yes_no)
    if parsed is not None:
        return ("number", tuple(_candidate_values(parsed)))
    if _DECLINED.search(span or ""):
        return ("declined",)
    return ("text", re.sub(r"\s+", " ", (span or "").strip().lower()))


def finqa_outputs_agree(a: tuple, b: tuple) -> bool:
    if a[0] != b[0]:
        return False
    if a[0] == "number":
        # equivalent if any reading of one matches any reading of the other, both ways
        return any(_numeric_match(x, y) and _numeric_match(y, x) for x in a[1] for y in b[1])
    return a == b


def tau_output(run: RunResult) -> frozenset:
    """What the conversation changed in the store: the end state, not the words used."""
    changes = run.db_changes or []
    return frozenset(
        json.dumps({"path": c.get("path"), "change": c.get("change"), "to": c.get("to", c.get("value"))}, sort_keys=True, default=str)
        for c in changes
    )


def output_consistency(runs: list[RunResult]) -> float | None:
    """Mean pairwise agreement of normalised final outputs (Raj et al. Eq. 1); None below 2 runs."""
    if len(runs) < 2:
        return None
    if runs[0].benchmark_id == "finqa":
        outputs = [finqa_output(r) for r in runs]
        agree = finqa_outputs_agree
    else:
        outputs = [tau_output(r) for r in runs]
        agree = lambda a, b: a == b  # noqa: E731
    pairs = list(combinations(outputs, 2))
    return sum(1.0 if agree(a, b) else 0.0 for a, b in pairs) / len(pairs)


# ---- execution consistency ------------------------------------------------------------


Call = tuple[str, frozenset]


def _operand(text: str) -> str:
    text = text.strip().lower()
    try:
        return f"{float(text.replace(',', '').replace('$', '')):.6g}"
    except ValueError:
        return text


def finqa_path(run: RunResult) -> list[Call] | None:
    """The operations of the model's program, with their operands; None if it wrote none."""
    program = extract_program(run.answer or "")
    if not program:
        return None
    try:
        calls = parse_program(program)
    except ValueError:
        return None
    if len(calls) > 1 and is_percent_conversion(calls[-1]):
        calls = calls[:-1]  # a final ×100 only restates the result as a percent
    return [(op, frozenset((str(i), _operand(a)) for i, a in enumerate(args))) for op, args in calls]


def tau_path(run: RunResult) -> list[Call] | None:
    """The tool calls the agent made, in order, with their arguments."""
    calls: list[Call] = []
    for step in run.steps or []:
        for call in getattr(step, "tool_calls", None) or []:
            args = call.get("arguments") or {}
            if not isinstance(args, dict):
                args = {"value": args}
            calls.append((
                str(call.get("name")),
                frozenset((str(k), json.dumps(v, sort_keys=True, default=str)) for k, v in args.items()),
            ))
    return calls


def _levenshtein(a: list[str], b: list[str]) -> int:
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def sequence_similarity(a: list[Call], b: list[Call]) -> float:
    """1 - normalised Levenshtein over the tool or operation names."""
    longest = max(len(a), len(b))
    if longest == 0:
        return 1.0
    return 1.0 - _levenshtein([c[0] for c in a], [c[0] for c in b]) / longest


def argument_similarity(a: list[Call], b: list[Call]) -> float | None:
    """Mean Jaccard of arguments over step-aligned calls; 0 where the tools differ."""
    aligned = min(len(a), len(b))
    if aligned == 0:
        return None
    total = 0.0
    for (name_a, args_a), (name_b, args_b) in zip(a[:aligned], b[:aligned]):
        if name_a != name_b:
            continue
        union = args_a | args_b
        total += 1.0 if not union else len(args_a & args_b) / len(union)
    return total / aligned


def execution_consistency(runs: list[RunResult]) -> float | None:
    """Mean over pairs of the path similarity; None when fewer than 2 runs have a path."""
    path = finqa_path if runs[0].benchmark_id == "finqa" else tau_path
    paths = [p for p in (path(r) for r in runs) if p is not None]
    if len(paths) < 2:
        return None
    scores = []
    for a, b in combinations(paths, 2):
        seq = sequence_similarity(a, b)
        args = argument_similarity(a, b)
        scores.append(seq if args is None else (seq + args) / 2)
    return sum(scores) / len(scores)


def consistency(group: Group) -> dict[str, Any]:
    outputs, executions = [], []
    for runs in group.runs.values():
        out = output_consistency(runs)
        if out is not None:
            outputs.append(out)
            ex = execution_consistency(runs)
            if ex is not None:
                executions.append(ex)
    output = sum(outputs) / len(outputs) if outputs else None
    execution = sum(executions) / len(executions) if executions else None
    combined = (
        OUTPUT_WEIGHT * output + EXECUTION_WEIGHT * execution
        if output is not None and execution is not None
        else None
    )
    return {
        "output": output,
        "execution": execution,
        "combined": combined,
        "tasks": len(outputs),
        "execution_tasks": len(executions),
        "weights": {"output": OUTPUT_WEIGHT, "execution": EXECUTION_WEIGHT},
    }


# ---- loading ------------------------------------------------------------------------


def load_runs(batches_dir: Path, history_file: Path) -> list[RunResult]:
    runs: list[RunResult] = []
    for path in sorted(batches_dir.glob("*.runs.jsonl")):
        batch_id = path.name.split(".")[0]
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                run = RunResult.model_validate_json(line)
                if not run.parent_run_id:  # older runs did not record their end-to-end run
                    run.parent_run_id = batch_id
                runs.append(run)
    if history_file.exists():
        for line in history_file.read_text(encoding="utf-8").splitlines():
            if line.strip():
                runs.append(RunResult.model_validate_json(line))
    return runs


def repeatability(runs: list[RunResult], *, benchmark_id: str | None = None, k: int = DEFAULT_K) -> list[dict[str, Any]]:
    out = []
    for group in group_runs(runs):
        if benchmark_id and group.benchmark_id != benchmark_id:
            continue
        attempts = [len(v) for v in group.runs.values()]
        batch_ids = sorted({r.parent_run_id for v in group.runs.values() for r in v if r.parent_run_id and r.parent_run_id.startswith("E2E-")})
        out.append({
            "configuration_id": group.configuration_id,
            "configuration_name": group.configuration_name,
            "architecture": group.architecture,
            "benchmark_id": group.benchmark_id,
            "mode": group.mode,
            "models": group.models,
            "condition": "-".join(group.key[4:]),
            "tasks": len(attempts),
            "attempts": sum(attempts),
            "max_attempts_per_task": max(attempts) if attempts else 0,
            "batch_ids": batch_ids,
            "reliability": reliability(group, k),
            "consistency": consistency(group),
        })
    out.sort(key=lambda g: (g["benchmark_id"], -(g["reliability"]["eligible_tasks"]), g["configuration_name"]))
    return out

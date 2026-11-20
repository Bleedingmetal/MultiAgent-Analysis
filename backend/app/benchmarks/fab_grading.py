"""Rubric grading for the Finance Agent Benchmark v2.1.

What follows the official methodology (vals.ai FAB v2.1, vals-ai/finance-agent-v2):
  - every question has a rubric of weighted criteria (severity 1, 2 or 3), some marked
    must_pass ("dealbreakers");
  - Partial Credit (primary): 0 if any must_pass criterion fails, otherwise the
    severity-weighted share of criteria passed;
  - All-Pass (secondary): 1 only when every criterion passes;
  - hedged answers fail: giving two or more candidate values for an item without
    committing to one fails the criteria that check that item.

What is an approximation, because it is not public:
  - the official judges are a jury of GPT-6.1 Sol, Gemini 3.8 Flash and Claude Sonnet 5.5,
    with an unpublished judge prompt and aggregation rule. Here the jury is
    FAB_JUDGE_MODELS (default: one cheap Claude) with a majority vote per criterion
    (ties fail), and the prompt below is ours;
  - the research tools differ (see fab_tools), so the agent sees different search results.
Scores are therefore comparable across our configurations, not with the vals.ai leaderboard.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.config import settings
from app.llm import complete, infer_provider

METHOD = "fab-v2.1-rubric (approximate jury)"
APPROXIMATION_NOTE = (
    "Rubric and scoring rules follow FAB v2.1. The judge jury is not the official one "
    "(GPT-6.1 Sol, Gemini 3.8 Flash, Claude Sonnet 5.5; its prompt and aggregation are "
    "unpublished), so scores are not comparable with the vals.ai leaderboard."
)

JUDGE_SYSTEM = """You grade a financial analyst's answer against a rubric. For each criterion, decide whether the answer satisfies it.

Rules:
- Judge only what the answer states. Do not use your own knowledge to fill gaps.
- A criterion passes when the answer clearly states the required fact, figure or conclusion. Equivalent wording, units and formats are fine (e.g. $1.2 billion = $1,200 million), and figures may differ from the criterion by rounding only (about 1% relative, or the last reported digit).
- Hedging fails: if the answer gives two or more candidate values or conclusions for the item a criterion checks (e.g. "either $4.1B or $4.3B", "between 10% and 12% depending on..."), without committing to one, that criterion fails.
- Extra information does not hurt unless it contradicts what the criterion requires.

Reply with JSON only, in this shape:
{"criteria": [{"id": 0, "pass": true, "reason": "<one short sentence>"}], "hedged": false}
Include every criterion id exactly once. "hedged" is true if the answer hedges anywhere."""


def judge_prompt(question: str, answer: str, rubric: list[dict[str, Any]]) -> str:
    lines = "\n".join(f"{c['id']}. {c['criterion']}" for c in rubric)
    return f"Question:\n{question}\n\nAnswer to grade:\n{answer.strip() or '(empty)'}\n\nCriteria:\n{lines}"


def parse_verdicts(text: str, ids: list[int]) -> tuple[dict[int, tuple[bool, str]], bool] | None:
    """The judge's JSON as {criterion id: (passed, reason)}, or None if it is unusable."""
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    verdicts: dict[int, tuple[bool, str]] = {}
    for row in data.get("criteria") or []:
        try:
            cid = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        if cid in ids and isinstance(row.get("pass"), bool):
            verdicts[cid] = (row["pass"], str(row.get("reason") or "")[:400])
    if set(verdicts) != set(ids):
        return None
    return verdicts, bool(data.get("hedged"))


def score(rubric: list[dict[str, Any]], passed: dict[int, bool]) -> dict[str, Any]:
    """Partial Credit and All-Pass from per-criterion results (the official scoring rules)."""
    total = sum(c["severity"] for c in rubric)
    earned = sum(c["severity"] for c in rubric if passed.get(c["id"]))
    dealbreaker = any(c["must_pass"] and not passed.get(c["id"]) for c in rubric)
    partial = 0.0 if dealbreaker or not total else earned / total
    return {
        "partial_credit": partial,
        "all_pass": bool(rubric) and all(passed.get(c["id"]) for c in rubric),
        "dealbreaker_failed": dealbreaker,
        "weighted_passed": earned,
        "weighted_total": total,
    }


def grade(question: str, answer: str, rubric: list[dict[str, Any]], *, meter=None, version: str = "2.1",
          commit: str | None = None) -> dict[str, Any]:
    """Grade one answer with the jury. Returns the evaluation stored on the run."""
    judges = settings()["fab_judge_models"]
    ids = [c["id"] for c in rubric]
    prompt = judge_prompt(question, answer, rubric)
    votes: dict[int, list[dict[str, Any]]] = {i: [] for i in ids}
    hedged_votes: list[bool] = []
    failed_judges: list[str] = []
    cost = 0.0
    for model in judges:
        parsed = None
        for _ in range(2):  # one retry on unusable output
            result = complete(
                provider=infer_provider(model), model=model, system=JUDGE_SYSTEM, user=prompt,
                temperature=0.0, max_tokens=3_000,
                before_call=meter.before_call if meter else None,
            )
            cost += result.cost_usd
            if meter:
                meter.add_cost(result.cost_usd)
            parsed = parse_verdicts(result.text, ids)
            if parsed:
                break
        if not parsed:
            failed_judges.append(model)
            continue
        verdicts, hedged = parsed
        hedged_votes.append(hedged)
        for cid, (ok, reason) in verdicts.items():
            votes[cid].append({"model": model, "pass": ok, "reason": reason})

    base = {
        "method": METHOD,
        "official": False,
        "approximation_note": APPROXIMATION_NOTE,
        "fab_version": version,
        "fab_commit": commit,
        "judges": judges,
        "aggregation": "majority vote per criterion; ties fail",
        "failed_judges": failed_judges,
        "grading_cost_usd": round(cost, 6),
    }
    if len(failed_judges) == len(judges):
        return {**base, "error": "No judge returned a usable verdict.", "criteria": []}

    # Strict majority of the judges that answered; a tie fails
    passed = {cid: sum(v["pass"] for v in vs) * 2 > len(vs) for cid, vs in votes.items()}
    criteria = [
        {
            "id": c["id"],
            "criterion": c["criterion"],
            "severity": c["severity"],
            "must_pass": c["must_pass"],
            "passed": passed[c["id"]],
            "votes": votes[c["id"]],
        }
        for c in rubric
    ]
    return {
        **base,
        **score(rubric, passed),
        "hedged": sum(hedged_votes) * 2 > len(hedged_votes),
        "criteria_passed": sum(passed.values()),
        "criteria_total": len(rubric),
        "criteria": criteria,
    }

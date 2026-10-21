#!/usr/bin/env python3
"""Download benchmark files into backend/data (stdlib only)."""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

FINQA_TEST_URL = (
    "https://raw.githubusercontent.com/czyssrs/FinQA/main/dataset/test.json"
)
FAB_CSV_URL = (
    "https://raw.githubusercontent.com/vals-ai/finance-agent/main/data/public.csv"
)
TAU_RETAIL_TASKS_URL = (
    "https://raw.githubusercontent.com/sierra-research/tau-bench/main/"
    "tau_bench/envs/retail/tasks_test.py"
)

TAU_SAMPLE_SIZE = 15
FAB_SAMPLE_SIZE = 20
FINQA_SAMPLE_SIZE = 20


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def write_if_needed(
    path: Path,
    content: str | bytes,
    *,
    force: bool,
    label: str,
) -> bool:
    if path.exists() and not force:
        print(f"skip {label} (exists): {path.relative_to(ROOT)}")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, str):
        path.write_text(content, encoding="utf-8")
    else:
        path.write_bytes(content)
    print(f"wrote {label}: {path.relative_to(ROOT)}")
    return True


def download_finqa(force: bool) -> None:
    finqa_dir = DATA / "finqa"
    test_path = finqa_dir / "test.json"
    sample_path = finqa_dir / "sample20.json"

    if not test_path.exists() or force:
        print(f"fetching FinQA from {FINQA_TEST_URL}")
        raw = fetch(FINQA_TEST_URL)
        write_if_needed(test_path, raw, force=True, label="FinQA test.json")
    else:
        print(f"skip FinQA test.json (exists): {test_path.relative_to(ROOT)}")

    items = json.loads(test_path.read_text(encoding="utf-8"))
    if not isinstance(items, list):
        raise ValueError("FinQA test.json must be a JSON array")
    sample = items[:FINQA_SAMPLE_SIZE]
    write_if_needed(
        sample_path,
        json.dumps(sample, indent=2),
        force=force or not sample_path.exists(),
        label=f"FinQA sample ({len(sample)} tasks)",
    )
    print(f"FinQA tasks available: {len(items)} (sample: {len(sample)})")


def download_fab(force: bool) -> None:
    fab_dir = DATA / "fab"
    csv_path = fab_dir / "public.csv"
    sample_path = fab_dir / "sample20.json"

    if not csv_path.exists() or force:
        print(f"fetching FAB from {FAB_CSV_URL}")
        raw = fetch(FAB_CSV_URL).decode("utf-8")
        write_if_needed(csv_path, raw, force=True, label="FAB public.csv")
    else:
        print(f"skip FAB public.csv (exists): {csv_path.relative_to(ROOT)}")
        raw = csv_path.read_text(encoding="utf-8")

    rows = list(csv.DictReader(io.StringIO(raw)))
    sample = rows[:FAB_SAMPLE_SIZE]
    write_if_needed(
        sample_path,
        json.dumps(sample, indent=2),
        force=force or not sample_path.exists(),
        label=f"FAB sample ({len(sample)} rows)",
    )
    print(f"FAB rows available: {len(rows)} (sample: {len(sample)})")


def _parse_tau_retail_tasks(py_source: str) -> list[tuple[str, str]]:
    """Extract (user_id, instruction) per Task() block."""
    blocks = re.split(r"\bTask\s*\(", py_source)[1:]
    pairs: list[tuple[str, str]] = []
    for block in blocks:
        uid_m = re.search(r'user_id="([^"]+)"', block)
        ins_m = re.search(r'instruction="((?:\\.|[^"\\])*)"', block, re.S)
        if not uid_m or not ins_m:
            continue
        instruction = bytes(ins_m.group(1), "utf-8").decode("unicode_escape")
        pairs.append((uid_m.group(1), instruction))
    return pairs


def download_tau_retail(force: bool) -> None:
    tau_dir = DATA / "tau_bench"
    py_path = tau_dir / "tasks_test_retail.py"
    sample_path = tau_dir / "retail_sample.json"

    if not py_path.exists() or force:
        print(f"fetching τ-bench retail tasks from {TAU_RETAIL_TASKS_URL}")
        raw = fetch(TAU_RETAIL_TASKS_URL).decode("utf-8")
        write_if_needed(py_path, raw, force=True, label="τ-bench tasks_test_retail.py")
    else:
        print(f"skip τ-bench source (exists): {py_path.relative_to(ROOT)}")
        raw = py_path.read_text(encoding="utf-8")

    pairs = _parse_tau_retail_tasks(raw)
    if not pairs:
        raise ValueError(
            "Could not parse any τ-bench retail tasks from tasks_test_retail.py"
        )

    tasks = []
    for i, (uid, instruction) in enumerate(pairs[:TAU_SAMPLE_SIZE]):
        tasks.append(
            {
                "id": f"tau-retail-{i:03d}",
                "user_id": uid,
                "instruction": instruction,
            }
        )
    write_if_needed(
        sample_path,
        json.dumps(tasks, indent=2),
        force=force or not sample_path.exists(),
        label=f"τ-bench retail sample ({len(tasks)} tasks)",
    )
    print(
        f"τ-bench retail tasks parsed: {len(pairs)} "
        f"(sample: {len(tasks)})"
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download benchmark datasets into backend/data.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download files even if they already exist.",
    )
    parser.add_argument(
        "--only",
        choices=("finqa", "fab", "tau"),
        help="Download a single benchmark.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    steps = {
        "finqa": download_finqa,
        "fab": download_fab,
        "tau": download_tau_retail,
    }
    selected = [args.only] if args.only else list(steps.keys())

    print(f"Data directory: {DATA}")
    try:
        for key in selected:
            print(f"\n--- {key} ---")
            steps[key](args.force)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"\nerror: {exc}", file=sys.stderr)
        return 1

    print("\nDone. Start the app from the repository root with: npm run dev")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

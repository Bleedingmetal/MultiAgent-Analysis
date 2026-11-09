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
# tau2-bench keeps its domain data outside the package; tau-bench (v1) ships inside its package.
TAU2_RAW_ROOT = "https://raw.githubusercontent.com/sierra-research/tau2-bench/main/data/tau2/"
TAU2_RAW = TAU2_RAW_ROOT + "domains/retail/"
TAU2_API_ROOT = "https://api.github.com/repos/sierra-research/tau2-bench/contents/data/tau2/"
TAU2_RETAIL_FILES = ("db.json", "policy.md", "tasks.json", "split_tasks.json")
# The customer simulator builds its guidelines from the English language pack.
TAU2_PACK_FILES = ("multilingual/migration_manifest.json", "multilingual/telecom-caller-roles.json")
TAU2_PACK_DIR = "multilingual/en"
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


def download_tau2_retail(force: bool) -> None:
    """τ²-bench retail domain data (database, policy, tasks) for the tau2 package.

    The backend points TAU2_DATA_DIR at backend/data, and tau2 reads
    <TAU2_DATA_DIR>/tau2/domains/retail/. τ-bench (v1) needs no download: its
    data ships inside the tau_bench package.
    """
    tau_dir = DATA / "tau2" / "domains" / "retail"
    for name in TAU2_RETAIL_FILES:
        path = tau_dir / name
        if path.exists() and not force:
            print(f"skip τ²-bench {name} (exists): {path.relative_to(ROOT)}")
            continue
        print(f"fetching τ²-bench retail {name}")
        write_if_needed(path, fetch(TAU2_RAW + name), force=True, label=f"τ²-bench retail {name}")
    tasks_path = tau_dir / "tasks.json"
    if tasks_path.exists():
        with tasks_path.open(encoding="utf-8") as f:
            print(f"τ²-bench retail tasks available: {len(json.load(f))}")

    root = DATA / "tau2"
    wanted = [(rel, TAU2_RAW_ROOT + rel) for rel in TAU2_PACK_FILES]
    if force or not (root / TAU2_PACK_DIR / "pack.yaml").exists():
        wanted += _github_dir_files(TAU2_PACK_DIR)
    for rel, url in wanted:
        path = root / rel
        if path.exists() and not force:
            continue
        write_if_needed(path, fetch(url), force=True, label=f"τ²-bench {rel}")


def _github_dir_files(rel: str) -> list[tuple[str, str]]:
    """(relative path, download url) for every file under data/tau2/<rel> on GitHub."""
    listing = json.loads(fetch(TAU2_API_ROOT + rel).decode("utf-8"))
    out: list[tuple[str, str]] = []
    for item in listing:
        child = f"{rel}/{item['name']}"
        if item["type"] == "dir":
            out += _github_dir_files(child)
        elif item.get("download_url"):
            out.append((child, item["download_url"]))
    return out


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
        choices=("finqa", "fab", "tau2"),
        help="Download a single benchmark.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    steps = {
        "finqa": download_finqa,
        "fab": download_fab,
        "tau2": download_tau2_retail,
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

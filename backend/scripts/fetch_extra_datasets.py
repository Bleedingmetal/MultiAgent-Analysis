import csv
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def main() -> None:
    fab_dir = DATA / "fab"
    fab_dir.mkdir(parents=True, exist_ok=True)
    raw = fetch(
        "https://raw.githubusercontent.com/vals-ai/finance-agent/main/data/public.csv"
    ).decode("utf-8")
    (fab_dir / "public.csv").write_text(raw, encoding="utf-8")
    rows = list(csv.DictReader(io.StringIO(raw)))
    print("fab rows", len(rows), "cols", list(rows[0].keys()) if rows else None)
    (fab_dir / "sample20.json").write_text(
        json.dumps(rows[:20], indent=2),
        encoding="utf-8",
    )

    tau_py = DATA / "tau_bench" / "tasks_test_retail.py"
    text = tau_py.read_text(encoding="utf-8")
    ids = re.findall(r'user_id="([^"]+)"', text)
    instrs = re.findall(r'instruction="((?:\\.|[^"\\])*)"', text, re.S)
    print("tau ids", len(ids), "instrs", len(instrs))
    tasks = []
    for i, (uid, ins) in enumerate(zip(ids[:15], instrs[:15])):
        tasks.append(
            {
                "id": f"tau-retail-{i:03d}",
                "user_id": uid,
                "instruction": bytes(ins, "utf-8").decode("unicode_escape"),
            }
        )
    (DATA / "tau_bench" / "retail_sample.json").write_text(
        json.dumps(tasks, indent=2),
        encoding="utf-8",
    )
    print("wrote tau sample", len(tasks))
    print("wrote fab sample", min(20, len(rows)))


if __name__ == "__main__":
    main()

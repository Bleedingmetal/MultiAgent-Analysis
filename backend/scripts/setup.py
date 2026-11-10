#!/usr/bin/env python3
"""One-shot backend setup for a fresh clone (stdlib only, Windows/macOS/Linux).

1. Creates backend/.venv on Python 3.12+ (uses `uv` when installed, else `venv`).
2. Installs backend/requirements.txt (the two τ-bench packages come from GitHub).
3. Copies .env.example to .env when there is no .env yet.
4. Downloads the benchmark data that is not committed (FinQA, FAB, τ²-bench).

Run from anywhere:  python backend/scripts/setup.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
VENV = BACKEND / ".venv"
MIN = (3, 12)


def venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    env = {**os.environ, "PYTHONUTF8": "1", **kw.pop("env", {})}
    subprocess.run(cmd, check=True, env=env, **kw)


def find_python_312() -> list[str] | None:
    """A command that starts a Python >= 3.12, or None."""
    candidates: list[list[str]] = []
    if sys.version_info >= MIN:
        candidates.append([sys.executable])
    if os.name == "nt":
        candidates += [["py", "-3.13"], ["py", "-3.12"]]
    candidates += [["python3.13"], ["python3.12"], ["python3"], ["python"]]
    for cmd in candidates:
        try:
            out = subprocess.run(cmd + ["-c", "import sys; print(sys.version_info[:2] >= (3, 12))"],
                                 capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if out.returncode == 0 and out.stdout.strip() == "True":
            return cmd
    return None


def main() -> int:
    py = venv_python(VENV)
    if not py.exists():
        if shutil.which("uv"):
            # uv downloads a 3.12 interpreter itself when none is installed
            run(["uv", "venv", "--python", "3.12", str(VENV)])
        else:
            base = find_python_312()
            if not base:
                print("Python 3.12 or newer is required (the tau2 benchmark package needs it).\n"
                      "Install it from https://www.python.org/downloads/ or install uv "
                      "(https://docs.astral.sh/uv/) and run this script again.", file=sys.stderr)
                return 1
            run(base + ["-m", "venv", str(VENV)])
    if shutil.which("uv"):
        run(["uv", "pip", "install", "--python", str(py), "-r", str(BACKEND / "requirements.txt")])
    else:
        run([str(py), "-m", "pip", "install", "--upgrade", "pip"])
        run([str(py), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])

    env_file = BACKEND / ".env"
    if not env_file.exists():
        shutil.copy(BACKEND / ".env.example", env_file)
        print(f"created {env_file} - add OPENAI_API_KEY and ANTHROPIC_API_KEY to it")

    run([str(py), str(BACKEND / "scripts" / "download_datasets.py")])
    print("\nBackend ready. Start everything from the repository root with: npm run dev")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

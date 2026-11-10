#!/usr/bin/env python3
"""Set up the whole repository after a clone. Stdlib only; Windows, macOS, Linux.

    python setup.py            (python3 on macOS/Linux)

What it does, skipping anything already done:
  1. Checks for Git, Node 18+, and npm, and says exactly what to install if missing.
  2. Creates backend/.venv on Python 3.12+ (the tau2 benchmark package needs it).
     Uses `uv` when present; otherwise installs uv into this Python and lets it
     fetch a 3.12 interpreter, so no manual Python install is needed.
  3. Installs backend/requirements.txt (the two tau-bench packages come from GitHub).
  4. Creates backend/.env from .env.example when there is no .env yet.
  5. Downloads the benchmark data that is not committed (FinQA, FAB, tau2-bench).
  6. Installs the frontend's npm packages.

Then: add OPENAI_API_KEY / ANTHROPIC_API_KEY to backend/.env and run `python start.py`.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
ENV = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}


def real_key(value: str) -> bool:
    """A key that is not the placeholder from .env.example."""
    v = value.strip().strip('"')
    return bool(v) and "your-key" not in v


def say(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, env=ENV, check=check).returncode


def which(name: str) -> str | None:
    return shutil.which(name) or (shutil.which(name + ".cmd") if os.name == "nt" else None)


def version_of(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=ENV).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def check_tools() -> bool:
    ok = True
    if not which("git"):
        print("Git is required (the benchmark packages install from GitHub): https://git-scm.com/downloads")
        ok = False
    node = which("node")
    node_v = version_of([node, "--version"]) if node else ""
    major = int(node_v.lstrip("v").split(".")[0]) if node_v.startswith("v") else 0
    if major < 18:
        print(f"Node.js 18 or newer is required (found {node_v or 'none'}): https://nodejs.org/")
        ok = False
    if not which("npm"):
        print("npm is required; it ships with Node.js: https://nodejs.org/")
        ok = False
    return ok


def uv_command() -> list[str] | None:
    """`uv` as a command, installing it into this Python if it is not on PATH."""
    if which("uv"):
        return ["uv"]
    if subprocess.run([sys.executable, "-m", "uv", "--version"], capture_output=True).returncode == 0:
        return [sys.executable, "-m", "uv"]
    say("Installing uv (manages the Python 3.12 environment)")
    if run([sys.executable, "-m", "pip", "install", "--user", "--quiet", "uv"], check=False) == 0 \
            and subprocess.run([sys.executable, "-m", "uv", "--version"], capture_output=True).returncode == 0:
        return [sys.executable, "-m", "uv"]
    return None


def python312() -> list[str] | None:
    candidates: list[list[str]] = []
    if sys.version_info >= (3, 12):
        candidates.append([sys.executable])
    if os.name == "nt":
        candidates += [["py", "-3.13"], ["py", "-3.12"]]
    candidates += [["python3.13"], ["python3.12"], ["python3"], ["python"]]
    for cmd in candidates:
        out = version_of(cmd + ["-c", "import sys; print(sys.version_info >= (3, 12))"])
        if out == "True":
            return cmd
    return None


def venv_version() -> tuple[int, int] | None:
    """(major, minor) of the Python inside backend/.venv, or None if it is unusable."""
    if not PY.exists():
        return None
    out = version_of([str(PY), "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"])
    try:
        major, minor = out.split()
        return int(major), int(minor)
    except ValueError:
        return None


def retire_old_venv() -> None:
    """A half-done setup often has a 3.10 venv from the old README: move it aside
    (never delete) so a 3.12 one can be built; the user's .env is untouched."""
    ver = venv_version()
    if ver is None and PY.exists():
        say("backend/.venv is broken; moving it to backend/.venv-broken")
        target = VENV.with_name(".venv-broken")
    elif ver is not None and ver < (3, 12):
        say(f"backend/.venv is Python {ver[0]}.{ver[1]}; the tau2 package needs 3.12+. "
            f"Moving it to backend/.venv-py{ver[0]}{ver[1]}-old and creating a new one")
        target = VENV.with_name(f".venv-py{ver[0]}{ver[1]}-old")
    else:
        return
    if target.exists():
        shutil.rmtree(target)
    VENV.rename(target)


def setup_backend() -> None:
    uv = uv_command()
    retire_old_venv()
    if not PY.exists():
        say("Creating backend/.venv (Python 3.12+)")
        if uv:
            run(uv + ["venv", "--python", "3.12", str(VENV)])
        else:
            base = python312()
            if not base:
                sys.exit("Python 3.12+ is required and uv could not be installed. Install Python 3.12 "
                         "from https://www.python.org/downloads/ and run this script again.")
            run(base + ["-m", "venv", str(VENV)])
    say("Installing backend requirements")
    if uv:
        run(uv + ["pip", "install", "--python", str(PY), "-r", str(BACKEND / "requirements.txt")])
    else:
        run([str(PY), "-m", "pip", "install", "--quiet", "--upgrade", "pip"])
        run([str(PY), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])

    env_file = BACKEND / ".env"
    if not env_file.exists():
        shutil.copy(BACKEND / ".env.example", env_file)
        say(f"Created {env_file.relative_to(ROOT)}: add OPENAI_API_KEY and ANTHROPIC_API_KEY to it")
    else:
        say("Keeping the existing backend/.env (new settings all have defaults)")

    say("Checking benchmark data")
    run([str(PY), str(BACKEND / "scripts" / "download_datasets.py")])


def setup_frontend() -> None:
    say("Installing frontend packages")
    npm = which("npm")
    # `npm ci` wipes node_modules, which fails on Windows if a dev server or editor
    # still holds a file; on a half-done setup use the incremental install instead.
    cmd = [npm, "install"] if (FRONTEND / "node_modules").exists() else [npm, "ci"]
    if run(cmd, cwd=FRONTEND, check=False) != 0:
        print("npm failed; close any running dev server or editor using frontend/node_modules, retrying once...")
        import time
        time.sleep(5)
        run([npm, "install"], cwd=FRONTEND)


def main() -> int:
    say("Checking tools")
    if not check_tools():
        return 1
    setup_backend()
    setup_frontend()
    keys = (BACKEND / ".env").read_text(encoding="utf-8") if (BACKEND / ".env").exists() else ""
    has_key = any(real_key(line.split("=", 1)[1]) for line in keys.splitlines()
                  if line.startswith(("OPENAI_API_KEY=", "ANTHROPIC_API_KEY=")))
    say("Setup complete.")
    if not has_key:
        print("Next: put OPENAI_API_KEY and/or ANTHROPIC_API_KEY in backend/.env, then run: python start.py")
    else:
        print("Run the app with: python start.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

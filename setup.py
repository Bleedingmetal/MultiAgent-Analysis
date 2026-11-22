#!/usr/bin/env python3
"""Set up the whole repository after a clone, with one command. Stdlib only.

    python setup.py            (python3 on macOS/Linux)

Everything the app needs that is missing gets installed here, without admin rights:
  1. Node.js: if no Node 18+ is on PATH, a portable Node LTS is downloaded into .tools/
     and used from there by setup and start.
  2. Python 3.12+ for the backend venv (the tau2 benchmark package needs it): uses `uv`
     when present, otherwise installs uv into this Python and lets it fetch 3.12.
  3. backend/.venv with backend/requirements.txt (the two tau-bench packages come
     from GitHub as archives, so Git itself is not required).
  4. backend/.env from .env.example when there is no .env yet; an existing one keeps
     every value and gets any setting added since it was made.
  5. The benchmark data that is not committed (FinQA, FAB, tau2-bench).
  6. The frontend's npm packages.
Safe to rerun: each step is skipped when already done; an old 3.10 venv is moved
aside and rebuilt; an existing .env is kept.

Then: add OPENAI_API_KEY / ANTHROPIC_API_KEY to backend/.env and run `python start.py`.
No Python at all? Run setup.bat (Windows) or ./setup.sh (macOS/Linux) instead.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
TOOLS = ROOT / ".tools"
VENV = BACKEND / ".venv"
PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
NODE_LINE = "v22"  # Node LTS line used for the portable install
ENV = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}


# ---- helpers ------------------------------------------------------------------------

def say(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, env=ENV, check=check).returncode


def which(name: str) -> str | None:
    path = ENV.get("PATH", "")
    return shutil.which(name, path=path) or (shutil.which(name + ".cmd", path=path) if os.name == "nt" else None)


def version_of(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=ENV).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def real_key(value: str) -> bool:
    """A key that is not the placeholder from .env.example."""
    v = value.strip().strip('"')
    return bool(v) and "your-key" not in v


def portable_node_dirs() -> list[Path]:
    """bin directories of any portable Node under .tools/, newest first."""
    out = []
    for d in sorted(TOOLS.glob("node-v*"), reverse=True):
        bin_dir = d if os.name == "nt" else d / "bin"
        if (bin_dir / ("node.exe" if os.name == "nt" else "node")).exists():
            out.append(bin_dir)
    return out


def add_to_path(d: Path) -> None:
    ENV["PATH"] = str(d) + os.pathsep + ENV.get("PATH", "")


# ---- Node ---------------------------------------------------------------------------

def node_major() -> int:
    node = which("node")
    v = version_of([node, "--version"]) if node else ""
    return int(v.lstrip("v").split(".")[0]) if v.startswith("v") else 0


def install_portable_node() -> None:
    """Download Node LTS into .tools/ for this OS and CPU: no installer, no admin."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    if system == "windows":
        suffix, ext = ("win-arm64" if arm else "win-x64"), ".zip"
    elif system == "darwin":
        suffix, ext = ("darwin-arm64" if arm else "darwin-x64"), ".tar.gz"
    else:
        suffix, ext = ("linux-arm64" if arm else "linux-x64"), ".tar.gz"
    index = f"https://nodejs.org/dist/latest-{NODE_LINE}.x/"
    say(f"Node.js not found: downloading a portable Node {NODE_LINE} LTS for {suffix} into .tools/")
    with urllib.request.urlopen(index + "SHASUMS256.txt", timeout=60) as resp:
        listing = resp.read().decode()
    m = re.search(rf"(node-v{NODE_LINE[1:]}\.\d+\.\d+)-{re.escape(suffix)}{re.escape(ext)}", listing)
    if not m:
        sys.exit(f"No portable Node build for {suffix}. Install Node.js 18+ from https://nodejs.org/ and rerun.")
    name = m.group(1)
    archive = TOOLS / f"{name}-{suffix}{ext}"
    TOOLS.mkdir(exist_ok=True)
    print(f"  fetching {index}{archive.name}", flush=True)
    urllib.request.urlretrieve(f"{index}{archive.name}", archive)
    if ext == ".zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(TOOLS)
    else:
        with tarfile.open(archive) as t:
            t.extractall(TOOLS)
    archive.unlink()
    extracted = TOOLS / f"{name}-{suffix}"
    target = TOOLS / name
    if target.exists():
        shutil.rmtree(target)
    extracted.rename(target)
    for d in portable_node_dirs():
        add_to_path(d)
    print(f"  installed {name} at {target.relative_to(ROOT)}", flush=True)


def ensure_node() -> None:
    for d in portable_node_dirs():
        add_to_path(d)
    if node_major() >= 18 and which("npm"):
        print(f"Node {version_of([which('node'), '--version'])} found", flush=True)
        return
    install_portable_node()
    if node_major() < 18 or not which("npm"):
        sys.exit("Node.js could not be set up. Install Node.js 18+ from https://nodejs.org/ and rerun.")


# ---- Python / backend -----------------------------------------------------------------

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
        if version_of(cmd + ["-c", "import sys; print(sys.version_info >= (3, 12))"]) == "True":
            return cmd
    return None


def venv_version() -> tuple[int, int] | None:
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


def update_env(env_file: Path, example: Path) -> list[str]:
    """Append settings from .env.example that the .env lacks. Never changes an existing value."""
    have = {line.split("=", 1)[0].strip() for line in env_file.read_text(encoding="utf-8").splitlines()
            if "=" in line and not line.lstrip().startswith("#")}
    missing = [line for line in example.read_text(encoding="utf-8").splitlines()
               if "=" in line and not line.lstrip().startswith("#") and line.split("=", 1)[0].strip() not in have]
    # API keys are never filled with the example's placeholders
    missing = [line for line in missing if not line.split("=", 1)[0].strip().endswith("_API_KEY")]
    if missing:
        with env_file.open("a", encoding="utf-8") as f:
            f.write("\n# Added by setup.py (new settings, default values)\n" + "\n".join(missing) + "\n")
    return [line.split("=", 1)[0].strip() for line in missing]


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
        added = update_env(env_file, BACKEND / ".env.example")
        if added:
            say(f"Added {len(added)} new setting(s) to backend/.env with their defaults: {', '.join(added)}")
        else:
            say("backend/.env is up to date (your values are kept)")

    say("Checking benchmark data")
    run([str(PY), str(BACKEND / "scripts" / "download_datasets.py")])


# ---- frontend -------------------------------------------------------------------------

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
    print(f"Python {platform.python_version()} at {sys.executable}", flush=True)
    if not which("git"):
        print("Git not found; fine for setup (packages come as archives), but you need it to pull updates.", flush=True)
    ensure_node()
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

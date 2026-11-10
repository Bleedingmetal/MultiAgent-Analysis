#!/usr/bin/env python3
"""Run the whole app with one command: backend (in its own venv) and frontend.

    python start.py            (python3 on macOS/Linux)

Runs `python setup.py` first if the venv or the frontend packages are missing, so
a fresh clone works with just this command once the API keys are in backend/.env.
Ctrl-C stops both servers. Ports: BACKEND_PORT (8000) and FRONTEND_PORT (3000).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
BACKEND_PORT = os.environ.get("BACKEND_PORT", "8000")
FRONTEND_PORT = os.environ.get("FRONTEND_PORT", "3000")


def preflight() -> None:
    if not PY.exists() or not (FRONTEND / "node_modules").exists():
        print("First run: setting the repository up (this takes a few minutes once).", flush=True)
        if subprocess.run([sys.executable, str(ROOT / "setup.py")]).returncode != 0:
            sys.exit("Setup did not finish; fix the message above and run again.")
    env_file = BACKEND / ".env"
    text = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
    keys = {line.split("=", 1)[0]: line.split("=", 1)[1].strip()
            for line in text.splitlines() if "=" in line and not line.startswith("#")}
    if not any(k and "your-key" not in k for k in (keys.get("OPENAI_API_KEY"), keys.get("ANTHROPIC_API_KEY"))):
        print("WARNING: no OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env; the app will open "
              "but runs will fail until a key is added.", flush=True)


def pump(prefix: str, proc: subprocess.Popen) -> None:
    for line in proc.stdout:  # type: ignore[union-attr]
        sys.stdout.write(f"[{prefix}] {line}")
        sys.stdout.flush()


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    preflight()
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        sys.exit("npm not found; install Node.js from https://nodejs.org/")
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8",
           "NEXT_PUBLIC_API_URL": f"http://localhost:{BACKEND_PORT}"}
    backend = subprocess.Popen(
        [str(PY), "-m", "uvicorn", "app.main:app", "--reload", "--port", BACKEND_PORT],
        cwd=BACKEND, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace",
    )
    frontend = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", FRONTEND_PORT],
        cwd=FRONTEND, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace",
    )
    for name, proc in (("backend", backend), ("frontend", frontend)):
        threading.Thread(target=pump, args=(name, proc), daemon=True).start()
    print(f"\nApp: http://localhost:{FRONTEND_PORT}   API: http://localhost:{BACKEND_PORT}/api/health"
          "   (Ctrl-C stops both)\n", flush=True)
    try:
        while backend.poll() is None and frontend.poll() is None:
            threading.Event().wait(1)
    except KeyboardInterrupt:
        pass
    finally:
        print("\nStopping...", flush=True)
        stop(frontend)
        stop(backend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

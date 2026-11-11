#!/usr/bin/env python3
"""Run the whole app with one command: backend (in its own venv) and frontend.

    npm run dev          (or: python start.py / python3 start.py / ./start.sh / start.bat)

Sets the repository up first (venv, packages, data) if anything is missing, so a
fresh clone works with just this command once the API keys are in backend/.env.
If port 8000 or 3000 is taken, the next free port is used and printed.
Ctrl-C stops both servers. Preferred ports: BACKEND_PORT (8000), FRONTEND_PORT (3000).
"""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def preflight() -> None:
    venv_ok = PY.exists() and subprocess.run(
        [str(PY), "-c", "import sys, tau2; assert sys.version_info >= (3, 12)"],
        capture_output=True).returncode == 0
    if not venv_ok or not (FRONTEND / "node_modules").exists():
        print("Setting the repository up first (a few minutes, once).", flush=True)
        if subprocess.run([sys.executable, str(ROOT / "setup.py")]).returncode != 0:
            sys.exit("Setup did not finish; fix the message above and run again.")
    env_file = BACKEND / ".env"
    text = env_file.read_text(encoding="utf-8") if env_file.exists() else ""
    keys = {line.split("=", 1)[0]: line.split("=", 1)[1].strip()
            for line in text.splitlines() if "=" in line and not line.startswith("#")}
    if not any(k and "your-key" not in k for k in (keys.get("OPENAI_API_KEY"), keys.get("ANTHROPIC_API_KEY"))):
        print("WARNING: no OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env; the app will open "
              "but runs will fail until a key is added.", flush=True)


def free_port(preferred: int) -> int:
    """`preferred` if nothing listens on it, else the next free port above it."""
    port = preferred
    while port < preferred + 50:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    sys.exit(f"No free port near {preferred}")


def pump(prefix: str, proc: subprocess.Popen) -> None:
    for line in proc.stdout:  # type: ignore[union-attr]
        sys.stdout.write(f"[{prefix}] {line}")
        sys.stdout.flush()


def spawn(cmd: list[str], cwd: Path, env: dict) -> subprocess.Popen:
    kw: dict = {}
    if os.name != "nt":
        kw["start_new_session"] = True  # own process group, so npm's children die with it
    return subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", **kw)


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass


def main() -> int:
    preflight()
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        sys.exit("npm not found; install Node.js from https://nodejs.org/")
    backend_port = free_port(int(os.environ.get("BACKEND_PORT", "8000")))
    frontend_port = free_port(int(os.environ.get("FRONTEND_PORT", "3000")))
    for name, want, got in (("backend", os.environ.get("BACKEND_PORT", "8000"), backend_port),
                            ("frontend", os.environ.get("FRONTEND_PORT", "3000"), frontend_port)):
        if int(want) != got:
            print(f"Port {want} is in use (another copy running?); {name} will use {got}.", flush=True)
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8",
           "NEXT_PUBLIC_API_URL": f"http://localhost:{backend_port}"}
    backend = spawn([str(PY), "-m", "uvicorn", "app.main:app", "--reload", "--port", str(backend_port)], BACKEND, env)
    frontend = spawn([npm, "run", "dev", "--", "--port", str(frontend_port)], FRONTEND, env)
    for name, proc in (("backend", backend), ("frontend", frontend)):
        threading.Thread(target=pump, args=(name, proc), daemon=True).start()
    print(f"\nApp: http://localhost:{frontend_port}   API: http://localhost:{backend_port}/api/health"
          "   (Ctrl-C stops both)\n", flush=True)
    try:
        while backend.poll() is None and frontend.poll() is None:
            threading.Event().wait(1)
        if backend.poll() is not None:
            print(f"\nbackend exited with code {backend.returncode}", flush=True)
        if frontend.poll() is not None:
            print(f"\nfrontend exited with code {frontend.returncode}", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        print("\nStopping...", flush=True)
        stop(frontend)
        stop(backend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

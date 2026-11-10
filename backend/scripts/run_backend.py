#!/usr/bin/env python3
"""Start the API with the backend's own virtualenv, on any OS (used by `npm run dev`)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PY = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

if not PY.exists():
    print("backend/.venv is missing. Run: python backend/scripts/setup.py", file=sys.stderr)
    raise SystemExit(1)

raise SystemExit(
    subprocess.call(
        [str(PY), "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"],
        cwd=BACKEND,
        env={**os.environ, "PYTHONUTF8": "1"},
    )
)

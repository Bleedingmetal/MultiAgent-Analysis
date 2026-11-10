#!/usr/bin/env bash
# Run the whole app (backend + frontend). First run also sets everything up.
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 start.py "$@"; else exec python start.py "$@"; fi

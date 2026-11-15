#!/usr/bin/env bash
# One-command setup on macOS/Linux, even with no Python installed: gets Python 3
# through Homebrew or apt if needed, then runs setup.py (which installs Node.js if missing).
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 setup.py "$@"; fi
if command -v python >/dev/null 2>&1; then exec python setup.py "$@"; fi
echo "Python not found. Installing Python 3..."
if command -v brew >/dev/null 2>&1; then brew install python@3.12 && exec python3 setup.py "$@"; fi
if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip && exec python3 setup.py "$@"; fi
echo "Could not install Python automatically. Install it from https://www.python.org/downloads/ and run ./setup.sh again."
exit 1

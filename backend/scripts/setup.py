#!/usr/bin/env python3
"""Backend setup moved to the repository root: run `python setup.py` there."""
import runpy
import sys
from pathlib import Path

sys.argv[0] = str(Path(__file__).resolve().parents[2] / "setup.py")
runpy.run_path(sys.argv[0], run_name="__main__")

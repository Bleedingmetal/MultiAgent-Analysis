@echo off
rem One-command setup on Windows, even with no Python installed: installs Python 3.12
rem through winget if needed, then runs setup.py (which installs Node.js if missing).
cd /d "%~dp0"
where py >nul 2>nul && (py -3 setup.py %* & goto :eof)
where python >nul 2>nul && (python setup.py %* & goto :eof)
echo Python not found. Installing Python 3.12 with winget...
winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo Could not install Python automatically. Install it from https://www.python.org/downloads/ and run setup.bat again.
  exit /b 1
)
echo Python installed. Open a NEW terminal and run setup.bat again so it is on PATH.

@echo off
rem Run the whole app (backend + frontend). First run also sets everything up.
cd /d "%~dp0"
where py >nul 2>nul && (py start.py %*) || (python start.py %*)

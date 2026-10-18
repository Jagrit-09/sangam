@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py server\app.py) || (python server\app.py)
pause

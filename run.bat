@echo off
title CineVault - Online Movie Ticket Booking System
echo ====================================================
echo   CineVault Cinema Booking Server (SQLite + Python)
echo ====================================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python 3 was not found in PATH. Please install Python 3.9+ and try again.
    pause
    exit /b 1
)

echo Starting Python micro-server on http://localhost:5000 ...
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"
python server.py
pause

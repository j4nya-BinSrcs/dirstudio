@echo off
echo 🚀 Starting DirStudio...

REM === CONFIG ===
set FRONTEND_DIR=dirstudio\client
set BACKEND_DIR=dirstudio\server
set FRONTEND_PORT=3000

REM === START FRONTEND ===
echo 📦 Starting frontend...
start cmd /k "cd /d %FRONTEND_DIR% && python -m http.server %FRONTEND_PORT%"

REM === START BACKEND ===
echo ⚙️ Starting backend...
start cmd /k "cd /d %BACKEND_DIR% && uv run src\main.py --server"

REM === WAIT ===
timeout /t 2 > nul

REM === OPEN BROWSER ===
echo 🌐 Opening browser...
start http://localhost:%FRONTEND_PORT%

echo ✅ DirStudio is running!

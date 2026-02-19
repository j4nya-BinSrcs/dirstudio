#!/bin/bash

echo "🚀 Starting DirStudio..."

# === CONFIG ===
FRONTEND_DIR="dirstudio/client"
BACKEND_DIR="dirstudio/server"
FRONTEND_PORT=3000

# === START FRONTEND ===
echo "📦 Starting frontend..."
cd "$FRONTEND_DIR" || exit
python3 -m http.server $FRONTEND_PORT &
FRONTEND_PID=$!

# === START BACKEND ===
echo "⚙️ Starting backend..."
cd - > /dev/null || exit
cd "$BACKEND_DIR" || exit
uv run src/main.py --server &
BACKEND_PID=$!

# === OPEN BROWSER ===
sleep 2
echo "🌐 Opening browser..."
xdg-open http://localhost:$FRONTEND_PORT 2>/dev/null || open http://localhost:$FRONTEND_PORT

# === CLEAN EXIT ===
trap "echo '🛑 Stopping servers...'; kill $FRONTEND_PID $BACKEND_PID" EXIT

wait

#!/bin/bash

# TimeFeed App Startup Script
# Stoppt laufende Dienste, baut die App neu und startet sie im Hintergrund

echo "🚀 Starting TimeFeed Application..."

# Finde und beende spezifische TimeFeed Prozesse
echo "🛑 Stopping running services..."

# Stoppe Server anhand der gespeicherten PID falls vorhanden
# ---------------------------------------------------------------------------
# Gezielt NUR Prozesse DIESER App beenden. PID-Verifikation über das
# Prozess-Arbeitsverzeichnis (readlink /proc/<pid>/cwd) — NIEMALS pkill auf
# 'node dist/index.js': alle Feed-Apps haben identische Prozess-Signaturen!
# Deckt auch verwaiste node-Kinder von 'npm start' und veraltete PID-Dateien ab.
# ---------------------------------------------------------------------------
kill_app_processes() {
    local app_server_dir="$1"
    local app_port="$2"
    local pids=""
    # Port-Inhaber zuerst: Wer auf dem App-Port lauscht, IST diese App —
    # funktioniert auch, wenn /proc/<pid>/cwd nicht lesbar ist (Sandbox-Reste).
    if [ -n "$app_port" ]; then
        local lpid
        lpid=$(ss -tlnp 2>/dev/null | grep ":${app_port} " | grep -oE 'pid=[0-9]+' | grep -oE '[0-9]+' | head -1)
        if [ -n "$lpid" ]; then
            kill "$lpid" 2>/dev/null || true
            sleep 2
            kill -0 "$lpid" 2>/dev/null && kill -9 "$lpid" 2>/dev/null || true
        fi
    fi
    [ -f logs/server.pid ] && pids="$(cat logs/server.pid 2>/dev/null)"
    pids="$pids $(pgrep -f 'node dist/index.js' 2>/dev/null || true)"
    pids="$pids $(pgrep -f 'npm start' 2>/dev/null || true)"
    local victims=""
    for pid in $pids; do
        [ -n "$pid" ] || continue
        if [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "$app_server_dir" ]; then
            victims="$victims $pid"
            kill "$pid" 2>/dev/null || true
        fi
    done
    [ -n "$victims" ] && sleep 2
    for pid in $victims; do
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    done
    rm -f logs/server.pid
}
kill_app_processes "/opt/TimeFeed/server" 3030

# Warte kurz damit Prozesse sauber beendet werden
sleep 2

# Navigiere zum App-Verzeichnis
cd "$(dirname "$0")"

echo "🔨 Building application..."

# Baue die Client-Anwendung
echo "  - Building client..."
cd client
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Client build failed!"
    exit 1
fi

# Baue die Server-Anwendung
echo "  - Building server..."
cd ../server
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Server build failed!"
    exit 1
fi

cd ..

echo "✅ Build completed successfully!"

# Erstelle Log-Verzeichnis falls nicht vorhanden
mkdir -p logs

echo "🌟 Starting application in background..."

# Starte Server im Hintergrund
cd server
nohup node dist/index.js > ../logs/server.log 2>&1 &
SERVER_PID=$!

# Speichere PID für späteres Beenden
echo $SERVER_PID > ../logs/server.pid

echo "✅ TimeFeed is now running!"
echo "📋 Server PID: $SERVER_PID"
echo "📄 Logs: logs/server.log"
echo "🌐 Application should be available at: http://localhost:3030"
echo ""
echo "To stop the application, run: ./stop.sh"
echo "To view logs, run: tail -f logs/server.log"
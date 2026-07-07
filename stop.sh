#!/bin/bash

# TimeFeed App Stop Script
# Stoppt die im Hintergrund laufende Anwendung

echo "🛑 Stopping TimeFeed Application..."

cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# Gezielt NUR Prozesse DIESER App beenden. PID-Verifikation über das
# Prozess-Arbeitsverzeichnis (readlink /proc/<pid>/cwd) — NIEMALS pkill auf
# 'node dist/index.js': alle Feed-Apps haben identische Prozess-Signaturen!
# Deckt auch verwaiste node-Kinder von 'npm start' und veraltete PID-Dateien ab.
# ---------------------------------------------------------------------------
kill_app_processes() {
    local app_server_dir="$1"
    local pids=""
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

kill_app_processes "/opt/TimeFeed/server"
echo "✅ Server gestoppt (nur TimeFeed-Prozesse, cwd-verifiziert)."
echo "✅ TimeFeed has been stopped!"

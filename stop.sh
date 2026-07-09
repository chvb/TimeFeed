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
    local app_port="$2"
    local pids=""
    # Port-Inhaber zuerst: Wer auf dem App-Port lauscht, IST diese App —
    # funktioniert auch, wenn /proc/<pid>/cwd nicht lesbar ist (Sandbox-Reste).
    if [ -n "$app_port" ]; then
        # ss zeigt die PID nur mit ausreichenden Rechten. Fallback: Besitzer des
        # LISTEN-Sockets über die Inode aus /proc/net/tcp{,6} + /proc/*/fd ermitteln —
        # greift AUCH, wenn /proc/<pid>/cwd unlesbar ist (verwaiste Sandbox-Prozesse).
        local port_pids ppid
        port_pids="$(ss -tlnp 2>/dev/null | grep ":${app_port} " | grep -oE 'pid=[0-9]+' | grep -oE '[0-9]+')"
        if [ -z "$port_pids" ]; then
            local hex inodes ino fd
            hex=$(printf '%04X' "$app_port")
            inodes=$(awk -v p=":$hex" '$4=="0A" && $2 ~ (p"$") {print $10}' /proc/net/tcp /proc/net/tcp6 2>/dev/null)
            for ino in $inodes; do
                for fd in /proc/[0-9]*/fd/*; do
                    [ "$(readlink "$fd" 2>/dev/null)" = "socket:[$ino]" ] && port_pids="$port_pids $(printf '%s' "$fd" | cut -d/ -f3)"
                done
            done
        fi
        for ppid in $port_pids; do
            [ -n "$ppid" ] || continue
            kill "$ppid" 2>/dev/null || true
        done
        if [ -n "$port_pids" ]; then
            sleep 2
            for ppid in $port_pids; do
                kill -0 "$ppid" 2>/dev/null && kill -9 "$ppid" 2>/dev/null || true
            done
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
echo "✅ Server gestoppt (nur TimeFeed-Prozesse, cwd-verifiziert)."
echo "✅ TimeFeed has been stopped!"

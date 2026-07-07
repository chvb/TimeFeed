#!/bin/bash
# TimeFeed Auto-Update Script
# Holt den neuesten Stand von GitHub, baut Client + Server neu und startet neu.
# Nutzung:  bash update.sh          (interaktiv)
#           bash update.sh --auto   (ohne Rückfrage, z.B. aus Cron/Admin-Panel)
set -e

TIMEFEED_DIR="/opt/TimeFeed"
LOG_FILE="$TIMEFEED_DIR/update.log"
PORT="3030"
HEALTH_URL="http://localhost:${PORT}/health"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

do_update() {
    log "========== Auto-Update gestartet =========="
    cd "$TIMEFEED_DIR"

    # 0. Optionale Git-Credentials (falls Remote ohne eingebetteten Token).
    #    Standardmäßig steckt der Token bereits in der origin-URL, dann ist
    #    dieser Block ein No-Op.
    GIT_CREDENTIALS_WRITTEN=0
    if [ -n "$GIT_USERNAME" ] && [ -n "$GIT_TOKEN" ]; then
        git config --global credential.helper store
        echo "https://${GIT_USERNAME}:${GIT_TOKEN}@github.com" > ~/.git-credentials
        chmod 600 ~/.git-credentials
        GIT_CREDENTIALS_WRITTEN=1
        log "Git-Credentials temporär gesetzt"
    fi
    cleanup_git_credentials() {
        if [ "$GIT_CREDENTIALS_WRITTEN" = "1" ]; then
            rm -f ~/.git-credentials
            git config --global --unset credential.helper 2>/dev/null || true
            log "Git-Credentials entfernt"
        fi
    }
    trap cleanup_git_credentials EXIT

    # 1. Git Pull — harter Reset auf Remote für garantiert sauberen Stand.
    #    .env, database.sqlite, uploads/ und Build-Output sind .gitignore'd
    #    und bleiben dabei unangetastet.
    log "Git Pull..."
    git fetch origin master 2>&1 | tee -a "$LOG_FILE"
    git reset --hard origin/master 2>&1 | tee -a "$LOG_FILE"
    log "Git: $(git log --oneline -1)"

    # 2. Client-Abhängigkeiten + Build (Vite → server/public)
    log "Client-Dependencies + Build..."
    cd "$TIMEFEED_DIR/client"
    npm ci 2>&1 | tail -3 | tee -a "$LOG_FILE"
    npm run build 2>&1 | tail -5 | tee -a "$LOG_FILE"

    # 3. Server-Abhängigkeiten + Build (tsc → server/dist)
    log "Server-Dependencies + Build..."
    cd "$TIMEFEED_DIR/server"
    npm ci 2>&1 | tail -3 | tee -a "$LOG_FILE"
    npm run build 2>&1 | tail -5 | tee -a "$LOG_FILE"

    # 4. Neustart (kein PM2 — Start im Hintergrund wie start.sh)
    log "Server neu starten..."
    cd "$TIMEFEED_DIR"
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
    # Laufenden Server beenden (cwd-verifiziert, siehe kill_app_processes)
    kill_app_processes "/opt/TimeFeed/server" 3030
    sleep 1
    mkdir -p logs
    cd server
    nohup node dist/index.js > ../logs/server.log 2>&1 &
    echo $! > ../logs/server.pid
    cd ..
    log "Server gestartet (PID $(cat logs/server.pid))"

    # 5. Health Check (mit Retries)
    log "Health Check..."
    SUCCESS=0
    for i in 1 2 3 4 5 6; do
        sleep 2
        BODY=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")
        UPSEC=$(printf '%s' "$BODY" | grep -o '"processUptimeSeconds":[0-9]*' | cut -d: -f2)
        if [ -n "$BODY" ] && [ -n "$UPSEC" ] && [ "$UPSEC" -lt 60 ]; then
            log "✅ Update erfolgreich — NEUER Prozess antwortet (Uptime ${UPSEC}s) nach $((i * 2))s"
            SUCCESS=1
            break
        elif [ -n "$BODY" ] && [ -n "$UPSEC" ]; then
            log "  ⚠️ Es antwortet ein ALTER Prozess (Uptime ${UPSEC}s) — Neustart fehlgeschlagen!"
        fi
        log "  ⏳ HTTP $HTTP_CODE nach $((i * 2))s — warte..."
    done
    if [ "$SUCCESS" -ne 1 ]; then
        log "⚠️ Server antwortet nicht — bitte prüfen: tail -n 40 $TIMEFEED_DIR/logs/server.log"
        exit 1
    fi

    log "========== Auto-Update abgeschlossen =========="
}

# --- Auto-Modus ---
if [ "$1" = "--auto" ]; then
    do_update
    exit 0
fi

# --- Interaktiver Modus ---
echo ""
echo "╔══════════════════════════════════════╗"
echo "║      TimeFeed Update System       ║"
echo "╚══════════════════════════════════════╝"
echo ""

cd "$TIMEFEED_DIR"
CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unbekannt")
echo "Aktueller Stand: $CURRENT_COMMIT (Version $(cat VERSION 2>/dev/null || echo '?'))"
echo ""
echo "Prüfe auf Updates..."
git fetch origin master 2>/dev/null
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master 2>/dev/null || echo "")

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✅ TimeFeed ist auf dem neuesten Stand."
    exit 0
fi

echo "🔄 Updates verfügbar:"
echo ""
git log HEAD..origin/master --oneline --no-decorate | head -15
echo ""
read -p "Update jetzt durchführen? (j/N): " choice
if [[ ! $choice =~ ^[Jj]$ ]]; then
    echo "Abgebrochen."
    exit 0
fi
echo ""
do_update

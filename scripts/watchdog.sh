#!/bin/bash
# Feed-Apps-Watchdog: prüft die Health-Endpunkte und startet abgestürzte Server
# neu. Läuft per Cron (@reboot + alle 2 Minuten). Bewusst OHNE Build — gestartet
# wird immer der zuletzt gebaute Stand (dist/ + public/). Logs je App in logs/.
start_app() {
  local dir="$1" port="$2"
  if curl -sf -m 5 "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
    return 0
  fi
  # Alten Eintrag aus der PID-Datei gezielt beenden (NIE pattern-kill — mehrere
  # Feed-Apps haben identische Prozess-Signaturen!).
  local pidfile="${dir}/logs/server.pid"
  if [ -f "$pidfile" ]; then
    local pid; pid=$(cat "$pidfile")
    if [ -n "$pid" ] && [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "${dir}/server" ]; then
      kill "$pid" 2>/dev/null
      sleep 2
    fi
  fi
  mkdir -p "${dir}/logs"
  cd "${dir}/server" || return 1
  nohup node dist/index.js >> "${dir}/logs/server.log" 2>&1 &
  echo $! > "$pidfile"
  echo "$(date '+%F %T') Watchdog: ${dir} auf Port ${port} (neu) gestartet (PID $!)" >> "${dir}/logs/watchdog.log"
}

start_app /opt/TimeFeed 3030
start_app /opt/UrlaubsFeed 3020

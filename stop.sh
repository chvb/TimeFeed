#!/bin/bash

# TimeFeed App Stop Script
# Stoppt die im Hintergrund laufende Anwendung

echo "🛑 Stopping TimeFeed Application..."

cd "$(dirname "$0")"

# Stoppe Server anhand der gespeicherten PID
if [ -f "logs/server.pid" ]; then
    SERVER_PID=$(cat logs/server.pid)
    if kill -0 $SERVER_PID 2>/dev/null; then
        echo "  - Stopping server (PID: $SERVER_PID)..."
        kill $SERVER_PID
        # Warte auf sauberes Beenden
        sleep 3
        # Falls der Prozess noch läuft, beende ihn zwanghaft
        if kill -0 $SERVER_PID 2>/dev/null; then
            echo "  - Force killing server..."
            kill -9 $SERVER_PID
        fi
        rm logs/server.pid
        echo "✅ Server stopped successfully!"
    else
        echo "⚠️  Server PID $SERVER_PID is not running"
        rm logs/server.pid
    fi
else
    echo "⚠️  No server PID file found"
fi

# Zusätzlich alle verwandten Prozesse beenden
pkill -f "node.*timefeed" 2>/dev/null || true
pkill -f "node.*dist/index.js" 2>/dev/null || true

echo "✅ TimeFeed has been stopped!"
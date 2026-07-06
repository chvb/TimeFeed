#!/bin/bash

# TimeFeed App Status Script
# Zeigt den Status der Anwendung an

echo "📊 TimeFeed Application Status"
echo "================================="

cd "$(dirname "$0")"

# Prüfe Server Status
if [ -f "logs/server.pid" ]; then
    SERVER_PID=$(cat logs/server.pid)
    if kill -0 $SERVER_PID 2>/dev/null; then
        echo "🟢 Server: RUNNING (PID: $SERVER_PID)"
        
        # Zeige Speicherverbrauch
        MEMORY=$(ps -o pid,vsz,rss,comm -p $SERVER_PID | tail -n 1)
        echo "   Memory: $(echo $MEMORY | awk '{print $3}') KB"
        
        # Zeige Laufzeit
        START_TIME=$(ps -o lstart -p $SERVER_PID | tail -n 1)
        echo "   Started: $START_TIME"
        
    else
        echo "🔴 Server: NOT RUNNING (stale PID file)"
        rm logs/server.pid 2>/dev/null
    fi
else
    echo "🔴 Server: NOT RUNNING (no PID file)"
fi

echo ""

# Prüfe ob Port 3030 verwendet wird
if ss -tuln 2>/dev/null | grep -q ":3030 "; then
    echo "🟢 Port 3030: IN USE"
    echo "🌐 Application URL: http://localhost:3030"
else
    echo "🔴 Port 3030: FREE"
fi

echo ""

# Zeige letzte Log-Einträge falls vorhanden
if [ -f "logs/server.log" ]; then
    echo "📄 Last 5 log entries:"
    echo "----------------------"
    tail -n 5 logs/server.log
else
    echo "📄 No log file found"
fi

echo ""
echo "Commands:"
echo "  ./start.sh   - Start the application"
echo "  ./stop.sh    - Stop the application"  
echo "  ./restart.sh - Restart the application"
echo "  ./status.sh  - Show this status"
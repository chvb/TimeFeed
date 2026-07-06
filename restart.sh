#!/bin/bash

# TimeFeed App Restart Script
# Stoppt die Anwendung und startet sie neu

echo "🔄 Restarting TimeFeed Application..."

cd "$(dirname "$0")"

# Stoppe die Anwendung
./stop.sh

echo ""
echo "⏳ Waiting 2 seconds before restart..."
sleep 2

# Starte die Anwendung neu
./start.sh
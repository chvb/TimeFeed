#!/bin/bash

# TimeFeed App Startup Script
# Stoppt laufende Dienste, baut die App neu und startet sie im Hintergrund

echo "🚀 Starting TimeFeed Application..."

# Finde und beende spezifische TimeFeed Prozesse
echo "🛑 Stopping running services..."

# Stoppe Server anhand der gespeicherten PID falls vorhanden
if [ -f "logs/server.pid" ]; then
    SERVER_PID=$(cat logs/server.pid)
    if kill -0 $SERVER_PID 2>/dev/null; then
        echo "  - Stopping existing server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null || true
        sleep 2
    fi
    rm logs/server.pid 2>/dev/null || true
fi

# Beende nur TimeFeed-spezifische Prozesse
pkill -f "node.*dist/index.js.*TimeFeed" 2>/dev/null || true
pkill -f "node.*TimeFeed.*dist/index.js" 2>/dev/null || true
pkill -f "nodemon.*TimeFeed.*src/index.ts" 2>/dev/null || true
pkill -f "npm.*TimeFeed.*dev" 2>/dev/null || true

# Prüfe auf Prozesse die im TimeFeed Verzeichnis laufen
pgrep -f "/opt/TimeFeed" | xargs -r kill 2>/dev/null || true

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
nohup npm start > ../logs/server.log 2>&1 &
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
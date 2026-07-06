# TimeFeed Startup Scripts

Dieses Verzeichnis enthält Scripts zum einfachen Verwalten der TimeFeed-Anwendung.

## Verfügbare Scripts

### 🚀 `./start.sh`
Startet die Anwendung komplett neu:
- Beendet alle laufenden Dienste
- Baut Client und Server neu
- Startet den Server im Hintergrund
- Erstellt Log-Dateien in `logs/`

### 🛑 `./stop.sh`
Stoppt die laufende Anwendung sauber:
- Beendet den Server-Prozess
- Entfernt PID-Dateien
- Bereinigt verwandte Prozesse

### 🔄 `./restart.sh`
Neustart der Anwendung:
- Führt `stop.sh` aus
- Wartet kurz
- Führt `start.sh` aus

### 📊 `./status.sh`
Zeigt den aktuellen Status:
- Server-Status (läuft/läuft nicht)
- Speicherverbrauch
- Laufzeit
- Port-Status
- Letzte Log-Einträge

## Verwendung

```bash
# Anwendung starten
./start.sh

# Status prüfen
./status.sh

# Logs verfolgen
tail -f logs/server.log

# Anwendung stoppen
./stop.sh

# Neustart
./restart.sh
```

## Log-Dateien

- `logs/server.log` - Server-Ausgaben
- `logs/server.pid` - Prozess-ID des Servers

## URL

Nach dem Start ist die Anwendung verfügbar unter:
**http://localhost:3000**
# TimeFeed – Zeiterfassung Web-App

Moderne Stempeluhr- und Zeiterfassungs-App der Feed-Familie (React, TypeScript, Express.js, SQLite). Produktiv erreichbar unter **https://timefeed.de**.

## Features

- ⏱️ Kommen/Gehen-Stempelung (Web, Terminal-Modus mit NFC/Code/QR)
- 🧮 Zeitmodelle mit Soll/Ist-Vergleich und Überstundenkonto (pro Gruppe, mit Overrides pro Mitarbeiter)
- ☕ Pausenregelung pro Mandant: automatischer ArbZG-Abzug, Pausen-Stempeln oder Kombination
- 🏢 Mandantenfähig: Tenant → Firma → Gruppe → Mitarbeiter, Branding pro Mandant
- 🔐 Rollen: SuperAdmin, Admin, Buchhaltung, Verwaltung, Mitarbeiter
- 📄 DATEV-Export (LODAS / Lohn & Gehalt / CSV), pro Mandant konfigurierbar
- 📎 Stundenzettel-PDF-Upload zu Buchungen (S3)
- ☁️ S3-Speicher mit sekundärem Backup-Server (Dual-Write, Failover, Backfill)
- 📱 Voll responsive PWA (installierbar, Offline-Stempel-Queue am Terminal)
- 🌍 Mehrsprachig (DE/EN) über das i18n-System der Feed-Familie
- 🌐 RESTful API mit JWT-Authentifizierung, Audit-Log, Papierkorb

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Headless UI, Zustand, React Router
**Backend:** Node.js, Express, TypeScript, SQLite mit Sequelize, JWT, bcrypt

## Schnellstart

### Voraussetzungen
- Node.js 18+
- npm

### Installation

```bash
cd /opt/TimeFeed
npm run install:all
npm run dev
```

Die Anwendung ist dann verfügbar unter:
- Frontend/App: http://localhost:3030
- Vite-Dev-Server: http://localhost:3031
- Health Check: http://localhost:3030/health

### Betrieb

```bash
./start.sh      # Server starten (Client-Build wird ausgeliefert)
./stop.sh       # Server stoppen
./restart.sh    # Neustart
./status.sh     # Status + Health
./update.sh     # Update einspielen (git + Build + Neustart)
```

### Konfiguration

`server/.env` (siehe `server/.env.example`): `JWT_SECRET` (Pflicht), `PORT` (3030), `PUBLIC_URL=https://timefeed.de`, `CORS_ORIGIN`. SMTP- und S3-Zugangsdaten werden **in der Admin-UI** gepflegt (EmailSettings/StorageSettings in der DB), nicht per Env.

## Rollen

| Rolle | Rechte |
|-------|--------|
| SuperAdmin | Mandanten (Tenants) verwalten, in Mandanten wechseln |
| Admin | Alle Einstellungen des Mandanten (Zeitmodelle, Terminals, Branding, S3, E-Mail, Exportprofile) |
| Buchhaltung | Zeiten prüfen/korrigieren, Monatsabschluss, DATEV-/CSV-Export |
| Verwaltung | Zeiten anpassen und nachbuchen, Stundenzettel-Uploads |
| Mitarbeiter | Stempeln, eigene Zeiten und Saldo einsehen, Korrekturanträge |

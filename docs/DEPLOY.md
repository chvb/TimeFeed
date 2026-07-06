# TimeFeed – Deployment (timefeed.de)

## Architektur

TimeFeed läuft als ein Node-Prozess auf Port **3030** (Express liefert API **und** das gebaute SPA aus `server/public/`). Davor gehört ein Reverse-Proxy mit TLS — **HTTPS ist Pflicht**, weil Web-NFC, Kamera-QR-Scan, Geolocation und Web-Push im Browser nur über HTTPS (oder localhost) funktionieren.

## Nginx-Vhost (Beispiel)

```nginx
server {
    listen 80;
    server_name timefeed.de www.timefeed.de;
    return 301 https://timefeed.de$request_uri;
}

server {
    listen 443 ssl http2;
    server_name timefeed.de;

    ssl_certificate     /etc/letsencrypt/live/timefeed.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/timefeed.de/privkey.pem;

    client_max_body_size 15m;   # Stundenzettel-Uploads (Limit App-seitig 10 MB)

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Zertifikat: `certbot --nginx -d timefeed.de` (Let's Encrypt).

## server/.env (produktiv)

```
NODE_ENV=production
PORT=3030
JWT_SECRET=<openssl rand -hex 48>
PUBLIC_URL=https://timefeed.de
CORS_ORIGIN=https://timefeed.de
TRUST_PROXY=loopback
FORCE_HTTPS=true          # aktiviert HSTS, NUR mit TLS davor setzen
```

SMTP, S3 (primär + sekundärer Backup-Server) und die UrlaubsFeed-Kopplung werden **in der Admin-UI** gepflegt, nicht per Env.

## Betrieb

```bash
./start.sh    # baut Client+Server und startet (PID in logs/server.pid)
./status.sh   # Status + Health
./update.sh   # git pull + Build + Neustart (braucht eingerichtetes Git-Remote)
```

Autostart nach Reboot (Crontab des Betriebs-Users): `@reboot cd /opt/TimeFeed && ./start.sh`.

## Terminals (Tablets)

1. Admin → „Terminals" → Gerät anlegen, Token einmalig kopieren.
2. Am Tablet Chrome/Android: `https://timefeed.de/terminal` öffnen, Token eingeben, „App installieren" (PWA) und Vollbild aktivieren.
3. NFC: Chips mit dem Stempel-Code des Mitarbeiters als Text-Record beschreiben (oder die Chip-Seriennummer beim Mitarbeiter als `nfcTagUid` hinterlegen). iOS-Geräte nutzen den QR-Badge (Admin → Mitarbeiter → QR-Badge drucken) oder die Code-Eingabe.
4. Offline-Stempelungen werden lokal gepuffert und automatisch nachsynchronisiert.

## Checkliste Erstinstallation

- [ ] `server/.env` mit frischem JWT_SECRET
- [ ] Admin-Passwort nach erstem Login ändern (Demo-Seeds!)
- [ ] SMTP in Einstellungen → E-Mail hinterlegen + Testmail
- [ ] S3 primär + sekundär in Einstellungen → Speicher, Verbindungstest
- [ ] Zeitmodelle anlegen, Gruppen zuordnen, Personalnummern pflegen (DATEV!)
- [ ] Exportprofil (Berater-/Mandantennr.) setzen, erste LODAS-Datei vom Steuerberater testimportieren lassen
- [ ] UrlaubsFeed-Kopplung: dort API-Schlüssel erzeugen, hier unter Einstellungen → Integrationen eintragen

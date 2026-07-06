# TimeFeed – GitHub-Anbindung, Changelog & Updates

Dieses Projekt nutzt dasselbe Konzept wie FotoFeed, angepasst an TimeFeed
(Client `client/` + Server `server/`, SQLite, Start ohne PM2, Port **3030**).

## Überblick

| Datei | Zweck |
|-------|-------|
| `VERSION` | Aktuelle Version (Single Source of Truth) |
| `CHANGELOG.md` | Änderungshistorie (Markdown, automatisch gepflegt) |
| `scripts/generate-changelog.py` | Erzeugt Changelog-Einträge aus Git-Commits |
| `scripts/update-changelog.sh` | Lokaler Wrapper: generieren → committen → pushen |
| `.github/workflows/changelog.yml` | Dasselbe automatisch bei jedem Push (GitHub Action) |
| `.github/workflows/ci.yml` | Build-Check für Client & Server bei Push/PR |
| `update.sh` | Holt Updates von GitHub, baut & startet neu |
| `check-updates.sh` | Prüft nur, ob Updates vorliegen (Benachrichtigung) |
| `setup-update-cron.sh` | Richtet Cron-Jobs ein (User-Crontab) |

## Versionierung über Commit-Prefixe

Die nächste Version wird aus den Commit-Nachrichten abgeleitet:

- `[major] ...` → **2.0.0** (Breaking Changes)
- `[minor] ...` → **1.1.0** (neues Feature)
- (ohne Prefix) → **1.0.x** (Patch: Bugfixes, kleine Verbesserungen)

Commits, die Geheimnisse erwähnen (Passwort, Token, `.env` …), sowie
Merge-/Bot-/Setup-Commits werden automatisch herausgefiltert.

## Changelog automatisch erzeugen

**Automatisch (empfohlen):** Bei jedem Push auf `master` läuft die GitHub
Action `changelog.yml`, generiert die Einträge, hebt die Version an,
synchronisiert die `package.json`-Dateien und committet mit dem Marker
`[changelog-bot]` (löst keine erneute Ausführung aus).

**Lokal/manuell:**
```bash
cd /opt/TimeFeed
python3 scripts/generate-changelog.py   # nur Dateien aktualisieren
# oder inkl. commit + push:
bash scripts/update-changelog.sh
```

## Update durchführen

**Interaktiv:**
```bash
bash /opt/TimeFeed/update.sh
```
Zeigt verfügbare Änderungen und fragt nach Bestätigung.

**Automatisch (z.B. aus Admin-Panel/Cron):**
```bash
bash /opt/TimeFeed/update.sh --auto
```

`update.sh` macht: `git reset --hard origin/master` → `npm ci` + Build für
Client und Server → Neustart im Hintergrund → Health-Check auf
`http://localhost:3030/health`.

> **Wichtig:** `.env`, `database.sqlite` und `server/uploads/` sind in
> `.gitignore` und werden vom Update **nicht** angefasst.

## Cron einrichten

```bash
bash /opt/TimeFeed/setup-update-cron.sh
```
Legt in der User-Crontab an:
- Täglicher Update-Check (03:00) – nur Benachrichtigung
- Changelog-Generierung aus lokalen Commits (alle 30 Min)
- (optional, auskommentiert) automatisches wöchentliches Update

## GitHub-Authentifizierung

Der Origin enthält einen Personal-Access-Token des Nutzers `chvb`
(eingebettet in der Remote-URL, liegt nur lokal in `.git/config`, **nicht**
im Repository). Damit funktionieren `push`/`pull` und `update.sh` ohne
weitere Eingabe.

Token rotieren/ändern:
```bash
git remote set-url origin "https://chvb:NEUER_TOKEN@github.com/chvb/TimeFeed.git"
```

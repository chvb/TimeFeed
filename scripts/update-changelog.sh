#!/bin/bash
# Lokaler Changelog-Updater für TimeFeed.
# Generiert Changelog-Einträge aus neuen Commits, committet und pusht.
# Aufruf: manuell oder als Cron-Job (siehe setup-update-cron.sh).
set -e

TIMEFEED_DIR="/opt/TimeFeed"
cd "$TIMEFEED_DIR"

# Endlosschleife vermeiden: wenn der letzte Commit vom Bot stammt, nichts tun
LAST_MSG=$(git log -1 --format=%s 2>/dev/null || echo "")
if [[ "$LAST_MSG" == *"[changelog-bot]"* ]]; then
    exit 0
fi

# Changelog generieren (aktualisiert CHANGELOG.md, VERSION, package.json)
python3 scripts/generate-changelog.py || exit 0

# Nur wenn sich etwas geändert hat: committen + pushen
if ! git diff --quiet CHANGELOG.md VERSION package.json client/package.json server/package.json 2>/dev/null; then
    NEW_VER=$(cat VERSION)
    git add CHANGELOG.md VERSION package.json client/package.json server/package.json
    git commit -m "Changelog v${NEW_VER} automatisch aktualisiert [changelog-bot]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
    git push
    echo "$(date): Changelog v${NEW_VER} committed und gepusht"
else
    echo "$(date): keine Changelog-Änderungen"
fi

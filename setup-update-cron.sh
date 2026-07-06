#!/bin/bash
# Richtet automatische Cron-Jobs für TimeFeed ein.
#
# Anders als bei FotoFeed wird KEIN systemweiter Cron (/etc/cron.d, root)
# verwendet, da auf diesem Host kein (funktionierendes) sudo/root verfügbar
# ist. Stattdessen wird die User-Crontab von christoph genutzt.
#
# Eingerichtet werden:
#   1) Täglicher Update-Check (nur Benachrichtigung, kein Eingriff)   03:00
#   2) Changelog-Generierung aus lokalen Commits (alle 30 Min)
#
# Aufruf:  bash setup-update-cron.sh

set -e
TIMEFEED_DIR="/opt/TimeFeed"

echo "⏰ TimeFeed Cron-Jobs einrichten (User-Crontab: $(whoami))"
echo "============================================================"

MARK_BEGIN="# >>> TimeFeed cron >>>"
MARK_END="# <<< TimeFeed cron <<<"

# Bestehende TimeFeed-Einträge entfernen (idempotent)
CURRENT=$(crontab -l 2>/dev/null | sed "/$MARK_BEGIN/,/$MARK_END/d" || true)

NEW_BLOCK="$MARK_BEGIN
# Täglicher Update-Check (Benachrichtigung) um 03:00
0 3 * * * /opt/TimeFeed/check-updates.sh >> /opt/TimeFeed/update-check.log 2>&1
# Changelog aus lokalen Commits generieren (alle 30 Minuten)
*/30 * * * * /opt/TimeFeed/scripts/update-changelog.sh >> /opt/TimeFeed/update-check.log 2>&1
# Optional: automatisches woechentliches Update (Sonntag 02:00) — auskommentiert
# 0 2 * * 0 /opt/TimeFeed/update.sh --auto >> /opt/TimeFeed/auto-update.log 2>&1
$MARK_END"

printf '%s\n%s\n' "$CURRENT" "$NEW_BLOCK" | crontab -

chmod +x "$TIMEFEED_DIR"/update.sh "$TIMEFEED_DIR"/check-updates.sh \
         "$TIMEFEED_DIR"/scripts/update-changelog.sh 2>/dev/null || true

echo "✅ Cron-Jobs eingerichtet:"
echo "   - Update-Check täglich 03:00"
echo "   - Changelog-Generierung alle 30 Minuten"
echo ""
echo "📋 Aktuelle Crontab:"
crontab -l | sed -n "/$MARK_BEGIN/,/$MARK_END/p"
echo ""
echo "Zum Entfernen: 'crontab -e' und den TimeFeed-Block löschen."

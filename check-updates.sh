#!/bin/bash
# TimeFeed Update-Check
# Prüft, ob auf GitHub (origin/master) neue Commits vorliegen, und meldet sie.
# Verändert NICHTS am laufenden System. Für das eigentliche Update: update.sh

TIMEFEED_DIR="/opt/TimeFeed"
UPDATE_CHECK_FILE="$TIMEFEED_DIR/.last-update-check"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$TIMEFEED_DIR" || exit 1
[ -d ".git" ] || exit 0

CURRENT_VERSION=$(cat VERSION 2>/dev/null || echo "unbekannt")

git fetch origin master --quiet 2>/dev/null || exit 0
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master 2>/dev/null || echo "")

date > "$UPDATE_CHECK_FILE"

if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
    echo -e "${YELLOW}🔄 TimeFeed Updates verfügbar!${NC}"
    echo "Aktuelle Version: $CURRENT_VERSION"
    echo ""
    echo "Neue Änderungen:"
    git log HEAD..origin/master --oneline --no-decorate | head -10
    echo ""
    echo "Update ausführen mit:  bash /opt/TimeFeed/update.sh"
    exit 0
else
    echo -e "${GREEN}✅ TimeFeed ist auf dem neuesten Stand (Version $CURRENT_VERSION)${NC}"
    exit 0
fi

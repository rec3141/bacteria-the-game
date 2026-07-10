#!/usr/bin/env bash
# Deploy Bacteria! to bacteria.cryomics.org (DreamHost shared, user reric).
# Overlays files onto the docroot and NEVER deletes, so the live scores.json
# (the shared leaderboard data) is always preserved.
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="dreamhost:bacteria.cryomics.org/"  # home-relative on the remote (avoid local ~ expansion)

echo "==> deploy game files → $REMOTE"
rsync -avz \
  index.html game.js scores.php README.md Bacteria.swf assets \
  "$REMOTE"

echo "==> ensure the leaderboard store exists and is writable by PHP"
ssh dreamhost 'cd ~/bacteria.cryomics.org && { [ -f scores.json ] || printf "[]" > scores.json; } && chmod 664 scores.json && echo "   scores.json ready"'

echo "==> verify (expect 200s once DNS + Let'\''s Encrypt cert are live in the panel)"
printf "   site  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -L https://bacteria.cryomics.org/)"
printf "   api   %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -L https://bacteria.cryomics.org/scores.php)"
echo "==> done — https://bacteria.cryomics.org/"

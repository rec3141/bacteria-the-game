#!/usr/bin/env bash
# Deploy Bacteria! to bacteria.cryomics.org (DreamHost shared, user reric).
# Overlays files onto the docroot and NEVER deletes, so the live scores.json
# (the shared leaderboard data) is always preserved.
#
# The live site has been ahead of git before — a build deployed from a machine
# whose commits were never pushed — and a plain rsync silently overwrote it.
# So before touching anything this script:
#   1. compares the remote against what's about to be pushed BY CONTENT, and
#      stops if the live copy differs (a fresh `git clone` gives every file a
#      new mtime, so only a checksum can tell a real difference from a re-clone);
#   2. keeps a timestamped copy of every file it replaces, server-side, under
#      ~/bacteria-backups/<stamp>/.
#
# Usage: ./deploy.sh          # refuses to overwrite drifted files
#        ./deploy.sh --force  # overwrite anyway (backups are still taken)
set -euo pipefail
cd "$(dirname "$0")"

REMOTE_HOST="dreamhost"
REMOTE_DIR="bacteria.cryomics.org"          # home-relative on the remote (avoid local ~ expansion)
REMOTE="$REMOTE_HOST:$REMOTE_DIR/"
FILES=(index.html game.js scores.php README.md Bacteria.swf assets
       manifest.webmanifest icon.svg)

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_HOME="$(ssh "$REMOTE_HOST" 'echo $HOME')"
BACKUP_DIR="$REMOTE_HOME/bacteria-backups/$STAMP"

echo "==> checking the live site against this repo's history"
# The question that matters is NOT "does the live file differ from my edits?" -- it
# always will, that's why we're deploying. It's "did THIS repo ever produce the bytes
# that are live?" So: hash each live file the way git does, and look for that blob
# anywhere in our history (any commit, any branch) or in the current working tree.
#   found     -> the live file is a state we shipped; overwriting it loses nothing.
#   NOT found -> the live file came from somewhere we've never seen, e.g. commits that
#                only exist on another machine. That is the case that cost us the 24h
#                clock, and it is the case this guard exists to stop.
known_blobs() {   # every version of $1 this repo has ever held, plus the one on disk now
  git rev-list --all -- "$1" 2>/dev/null | while read -r c; do git rev-parse "$c:$1" 2>/dev/null; done
  git hash-object "$1" 2>/dev/null
}
DRIFT=""
for f in index.html game.js scores.php README.md manifest.webmanifest icon.svg Bacteria.swf; do
  [ -f "$f" ] || continue
  rhash="$(ssh "$REMOTE_HOST" "cat '$REMOTE_DIR/$f' 2>/dev/null" | git hash-object --stdin)"
  [ "$rhash" = "$(printf '' | git hash-object --stdin)" ] && continue  # absent remotely = a new file, not a conflict
  if ! known_blobs "$f" | sort -u | grep -qx "$rhash"; then DRIFT="$DRIFT$f
"; fi
done
DRIFT="$(printf '%s' "$DRIFT" | sed '/^$/d')"

if [ -n "$DRIFT" ]; then
  echo
  echo "   !! the LIVE copy of these files is NOT any version this repo has ever held:"
  printf '        %s\n' $DRIFT
  echo
  echo "   Someone deployed work that isn't in this history — most likely commits that"
  echo "   live on another machine and were never pushed. Overwriting destroys it."
  echo "   Fetch that work, or look at what's actually live first:"
  echo
  echo "        ssh $REMOTE_HOST 'cat $REMOTE_DIR/game.js' | diff - game.js"
  echo
  if [ "$FORCE" -ne 1 ]; then
    printf "   Overwrite anyway? replaced files are backed up to %s  (type 'yes'): " "$BACKUP_DIR"
    read -r ans || ans=""   # EOF (piped / CI) counts as "no", not as a crash
    [ "$ans" = "yes" ] || { echo "==> aborted — nothing on the server was changed"; exit 1; }
  else
    echo "   --force given — proceeding (backups are still taken)"
  fi
else
  echo "   live files match this checkout — safe to deploy"
fi

echo "==> deploy game files → $REMOTE"
echo "    (anything replaced is preserved in $BACKUP_DIR)"
# -c again so identical files aren't re-sent — which also keeps the backup dir
# free of pointless copies of files that never actually changed.
rsync -avzc --backup --backup-dir="$BACKUP_DIR" "${FILES[@]}" "$REMOTE"

echo "==> ensure the leaderboard store exists and is writable by PHP"
ssh "$REMOTE_HOST" 'cd ~/bacteria.cryomics.org && { [ -f scores.json ] || printf "[]" > scores.json; } && chmod 664 scores.json && echo "   scores.json ready"'

echo "==> prune old backups (keep the 10 most recent)"
ssh "$REMOTE_HOST" 'cd ~/bacteria-backups 2>/dev/null && ls -1t | tail -n +11 | xargs -r rm -rf; true'

echo "==> verify (expect 200s once DNS + Let'\''s Encrypt cert are live in the panel)"
printf "   site  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -L https://bacteria.cryomics.org/)"
printf "   api   %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -L https://bacteria.cryomics.org/scores.php)"
echo "==> done — https://bacteria.cryomics.org/"

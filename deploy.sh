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
# Usage: ./deploy.sh                                  # refuses to overwrite drifted files
#        ./deploy.sh --force                          # overwrite anyway (backups are still taken)
#        REMOTE_DIR=northinglab.com/bacteria ./deploy.sh   # deploy the same build elsewhere
set -euo pipefail
cd "$(dirname "$0")"

REMOTE_HOST="${REMOTE_HOST:-dreamhost}"
# home-relative on the remote (avoid local ~ expansion). Override to publish the same
# build to another docroot — each target keeps its own scores.json, so the leaderboards
# stay separate and one deploy can never clobber the other's data.
REMOTE_DIR="${REMOTE_DIR:-bacteria.cryomics.org}"
REMOTE="$REMOTE_HOST:$REMOTE_DIR/"
SITE_URL="${SITE_URL:-https://bacteria.cryomics.org/}"
# .htaccess ships too: without it DreamHost caches .js for 30 DAYS, which pins a phone to
# whichever build it happened to download first. A new docroot must never inherit that.
FILES=(index.html game.js scores.php score_schema.php feedback.php README.md Bacteria.swf assets
       manifest.webmanifest icon.svg .htaccess)

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_HOME="$(ssh "$REMOTE_HOST" 'echo $HOME')"
BACKUP_SLUG="$(printf '%s' "$REMOTE_DIR" | tr '/' '-')"   # keep each target's backups apart
BACKUP_DIR="$REMOTE_HOME/bacteria-backups/$BACKUP_SLUG-$STAMP"

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
# index.html and game.js are BUILD-STAMPED on the way out (__BUILD__ -> "<sha>-<time>"), so the
# live bytes never equal any blob in git — the guard would cry drift on every single deploy.
# Put the placeholder back before hashing and we're comparing like with like again.
# Only index.html and game.js carry the stamp. Piping the others through sed is pointless and
# actively breaks on macOS: BSD sed dies with "illegal byte sequence" on Bacteria.swf's binary
# bytes, which killed the whole deploy before it printed a word. LC_ALL=C keeps sed byte-safe
# even so, in case a stamped file ever picks up a stray non-UTF8 byte.
# No \b here: it's a GNU sed extension that BSD/macOS sed does not support, so on a Mac the
# substitution silently did nothing, every stamped file looked foreign, and the guard blocked
# every single deploy. The pattern is specific enough (7-40 hex, dash, exactly 10 digits) to
# not need word boundaries.
unstamp() { LC_ALL=C sed -E 's/([0-9a-f]{7,40}|dev)-[0-9]{10}/__BUILD__/g'; }
is_stamped() { [ "$1" = "index.html" ] || [ "$1" = "game.js" ]; }
DRIFT=""
for f in index.html game.js scores.php score_schema.php feedback.php README.md manifest.webmanifest icon.svg Bacteria.swf .htaccess; do
  [ -f "$f" ] || continue
  # `|| true` on the REMOTE side: a missing file makes cat exit non-zero, and with
  # `set -o pipefail` that would kill the whole deploy — which is exactly what happens
  # the first time you publish to a brand-new, empty docroot.
  if is_stamped "$f"; then
    rhash="$(ssh "$REMOTE_HOST" "cat '$REMOTE_DIR/$f' 2>/dev/null || true" | unstamp | git hash-object --stdin)"
  else
    rhash="$(ssh "$REMOTE_HOST" "cat '$REMOTE_DIR/$f' 2>/dev/null || true" | git hash-object --stdin)"
  fi
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

# Unique per-deploy build id (git commit + timestamp) — stamped into index.html
# and game.js so the app can tell when a newer build is live and bust the cache.
BUILD="$(git rev-parse --short HEAD 2>/dev/null || echo dev)-$(date +%y%m%d%H%M)"
echo "==> deploy game files (build $BUILD) → $REMOTE"
echo "    (anything replaced is preserved in $BACKUP_DIR)"
# Stamp in a copy, never in the working tree — deploying must not dirty the repo.
STAGE="$(mktemp -d)"
cp -R "${FILES[@]}" "$STAGE"/
# perl, not `sed -i`: GNU sed takes `-i` with no argument, BSD/macOS sed demands a backup suffix
# and otherwise swallows the expression as one ("invalid command code f"), killing the deploy.
perl -pi -e "s/__BUILD__/$BUILD/g" "$STAGE/index.html" "$STAGE/game.js"
# -c so identical files aren't re-sent — which also keeps the backup dir free of pointless
# copies of files that never changed. It matters doubly here: rsync's default quick check is
# size+mtime, and every file in a fresh staging dir has a brand-new mtime, so without -c each
# deploy would re-send and re-back-up the whole site.
# --chmod forces web-sane modes on the destination so a private staging dir (mktemp is 700)
# can never poison the live docroot's permissions — a 700 docroot is an instant 403.
rsync -rlvzc --chmod=D755,F644 --backup --backup-dir="$BACKUP_DIR" "$STAGE"/ "$REMOTE"
rm -rf "$STAGE"

echo "==> ensure the leaderboard store exists and is writable by PHP"
# follows $REMOTE_DIR: each target owns its own scores.json, so deploying the northinglab
# copy can't reach over and touch the cryomics leaderboard
ssh "$REMOTE_HOST" "cd ~/'$REMOTE_DIR' && { [ -f scores.json ] || printf '[]' > scores.json; } && chmod 664 scores.json && echo '   scores.json ready'"

echo "==> prune old backups (keep the 10 most recent FOR THIS TARGET)"
# scoped to this target's slug — otherwise a busy site's backups would evict the other's
ssh "$REMOTE_HOST" "cd ~/bacteria-backups 2>/dev/null && ls -1td '$BACKUP_SLUG'-* 2>/dev/null | tail -n +11 | xargs -r rm -rf; true"

echo "==> verify (expect 200s once DNS + Let'\''s Encrypt cert are live in the panel)"
printf "   site  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -L "$SITE_URL")"
printf "   api   %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -L "${SITE_URL}scores.php")"
echo "==> done — $SITE_URL"

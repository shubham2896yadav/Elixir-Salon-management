#!/bin/bash
# Makes a safe copy of the salon database. Runs every night via install-mac.sh, or run it by hand.
# Optional: BACKUP_DIR=/some/folder  KEEP_DAYS=60
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="$APP_DIR/server/salon.db"
BACKUP_DIR="${BACKUP_DIR:-$HOME/SalonBackups}"
KEEP_DAYS="${KEEP_DAYS:-60}"

if [ ! -f "$DB" ]; then
  echo "No database yet, nothing to back up."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/salon-$(date +%Y-%m-%d).db"
rm -f "$OUT"
/usr/bin/sqlite3 "$DB" ".backup '$OUT'"
find "$BACKUP_DIR" -name 'salon-*.db' -mtime +"$KEEP_DAYS" -delete
echo "Backed up to $OUT"

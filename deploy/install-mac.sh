#!/bin/bash
# Installs the salon app as a background service on this Mac:
#   - starts when you log in, restarts if it stops, keeps the Mac awake while plugged in
#   - makes a database backup every night at 2:00 AM into ~/SalonBackups
#
#   ./deploy/install-mac.sh              install (or update) and start
#   ./deploy/install-mac.sh --print      show what would be installed, change nothing
#   ./deploy/install-mac.sh --uninstall  stop and remove the service (your data is kept)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_LABEL="com.elixir.salon"
BACKUP_LABEL="com.elixir.salon.backup"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/ElixirSalon"
MODE="${1:-install}"

if [ "$MODE" = "--uninstall" ]; then
  for label in "$APP_LABEL" "$BACKUP_LABEL"; do
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$AGENTS_DIR/$label.plist"
  done
  echo "Salon service removed. Your data in $APP_DIR/server/salon.db and ~/SalonBackups was not touched."
  exit 0
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js is not installed. Install the current LTS version from https://nodejs.org and run this again." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required (found $("$NODE_BIN" -v))." >&2
  exit 1
fi

app_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$APP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>$NODE_BIN</string>
    <string>--import</string>
    <string>tsx</string>
    <string>server/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/app.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/app.log</string>
</dict>
</plist>
PLIST
}

backup_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$BACKUP_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/deploy/backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/backup.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/backup.log</string>
</dict>
</plist>
PLIST
}

if [ "$MODE" = "--print" ]; then
  echo "### $AGENTS_DIR/$APP_LABEL.plist"; app_plist
  echo; echo "### $AGENTS_DIR/$BACKUP_LABEL.plist"; backup_plist
  exit 0
fi

echo "Installing dependencies and building the app..."
(cd "$APP_DIR" && npm install --no-audit --no-fund && npm run build)

mkdir -p "$AGENTS_DIR" "$LOG_DIR"
app_plist > "$AGENTS_DIR/$APP_LABEL.plist"
backup_plist > "$AGENTS_DIR/$BACKUP_LABEL.plist"
for label in "$APP_LABEL" "$BACKUP_LABEL"; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS_DIR/$label.plist"
done
launchctl kickstart -k "gui/$(id -u)/$APP_LABEL"

sleep 3
echo
echo "The salon app is running. Open it on this Mac at:  http://localhost:4000"
grep "Open from other devices" "$LOG_DIR/app.log" 2>/dev/null | tail -3 || true
echo "Logs: $LOG_DIR"

#!/bin/zsh
set -eu
umask 077
if (( EUID == 0 )); then
  print 'Run this script without prefixing the entire command with sudo.'
  exit 1
fi
TASK_KEY_DIR=/Users/steve/.greenbubbles-acquire
TASK_STATE_DIR=/Users/steve/Projects/opstwin-advance/greenbubbles/.local-install
TASK_ACQUIRE=/opt/homebrew/bin/greenbubbles-acquire
TASK_CLI=/opt/homebrew/bin/greenbubbles
TASK_OWNER_UID=$(/usr/bin/id -u)
TASK_OWNER_GID=$(/usr/bin/id -g)
mkdir -p "$TASK_KEY_DIR" "$TASK_STATE_DIR"
if [[ ! -f "$TASK_STATE_DIR/capture-source-root.txt" ]]; then
  print 'No verified source selection file; ask Codex to select the source first.'
  exit 1
fi
TASK_DB_ROOT="$(<"$TASK_STATE_DIR/capture-source-root.txt")"
chmod 700 "$TASK_KEY_DIR"
trap 'print CAPTURE_FAILED > "$TASK_STATE_DIR/capture-phase.txt"' ZERR
if [[ -f "$TASK_KEY_DIR/passphrase.txt" ]]; then
  "$TASK_ACQUIRE" verify --db-root "$TASK_DB_ROOT" --passphrase-stdin < "$TASK_KEY_DIR/passphrase.txt"
  "$TASK_CLI" source status
  print CONNECTED > "$TASK_STATE_DIR/capture-phase.txt"
  exit 0
fi
if /usr/bin/pgrep -f '^/opt/homebrew/.*greenbubbles-acquire capture' >/dev/null; then
  print 'A capture is already running; stopped to avoid duplicate debugger attachment.'
  exit 1
fi
print AUTHENTICATING > "$TASK_STATE_DIR/capture-phase.txt"
print 'Capture-only setup: this script does not re-sign or restart WeChat.'
print 'Enter your Mac administrator password locally if prompted.'
sudo -v
print PREFLIGHT > "$TASK_STATE_DIR/capture-phase.txt"
if ! sudo "$TASK_ACQUIRE" preflight --db-root "$TASK_DB_ROOT" --json > "$TASK_STATE_DIR/capture-preflight.json" 2> "$TASK_STATE_DIR/capture-preflight-error.txt"; then
  print PREFLIGHT_FAILED > "$TASK_STATE_DIR/capture-phase.txt"
  /bin/cat "$TASK_STATE_DIR/capture-preflight.json" "$TASK_STATE_DIR/capture-preflight-error.txt"
  exit 1
fi
print CAPTURING > "$TASK_STATE_DIR/capture-phase.txt"
print 'Capture armed. Codex will operate WeChat logout/login. Leave this window open.'
if ! sudo "$TASK_ACQUIRE" capture --db-root "$TASK_DB_ROOT" --output "$TASK_KEY_DIR/passphrase.txt" --timeout-seconds 600 --json > "$TASK_STATE_DIR/capture-report.json" 2> "$TASK_STATE_DIR/capture-events.txt"; then
  print CAPTURE_FAILED > "$TASK_STATE_DIR/capture-phase.txt"
  /bin/cat "$TASK_STATE_DIR/capture-report.json" "$TASK_STATE_DIR/capture-events.txt"
  exit 1
fi
sudo /usr/sbin/chown "$TASK_OWNER_UID:$TASK_OWNER_GID" "$TASK_KEY_DIR/passphrase.txt"
chmod 600 "$TASK_KEY_DIR/passphrase.txt"
"$TASK_ACQUIRE" verify --db-root "$TASK_DB_ROOT" --passphrase-stdin < "$TASK_KEY_DIR/passphrase.txt"
"$TASK_CLI" source status
print CONNECTED > "$TASK_STATE_DIR/capture-phase.txt"
print 'Capture and database access verified. No key was displayed.'

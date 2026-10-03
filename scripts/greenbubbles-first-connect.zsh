#!/bin/zsh
set -eu
umask 077
if (( EUID == 0 )); then
  print 'Run this script as steve without prefixing the entire command with sudo.'
  print 'The script requests sudo only for the exact operations that need it.'
  exit 1
fi
TASK_OWNER_UID=$(/usr/bin/id -u)
TASK_OWNER_GID=$(/usr/bin/id -g)
TASK_KEY_DIR=/Users/steve/.greenbubbles-acquire
TASK_STATE_DIR=/Users/steve/Projects/opstwin-advance/greenbubbles/.local-install
TASK_WECHAT=/Applications/WeChat.app
TASK_ACQUIRE=/opt/homebrew/bin/greenbubbles-acquire
TASK_CLI=/opt/homebrew/bin/greenbubbles
mkdir -p "$TASK_KEY_DIR" "$TASK_STATE_DIR"
if [[ -e "$TASK_STATE_DIR/setup-go.txt" ]]; then
  print 'A previous capture-start marker exists. Ask Codex to review it before retrying.'
  exit 1
fi
chmod 700 "$TASK_KEY_DIR"
trap 'print FAILED > "$TASK_STATE_DIR/setup-phase.txt" 2>/dev/null || true' ZERR
if [[ -e "$TASK_KEY_DIR/passphrase.txt" ]]; then
  "$TASK_ACQUIRE" verify --passphrase-stdin < "$TASK_KEY_DIR/passphrase.txt"
  "$TASK_CLI" source status
  print 'Existing key verified; no re-signing or new capture was performed.'
  exit 0
fi
print 'GreenBubbles first connection — setup revision 2.'
print 'AUTHENTICATING' > "$TASK_STATE_DIR/setup-phase.txt"
print 'Enter the Mac administrator password locally.'
print 'The password will not be displayed or written to any log.'
sudo -v
# A previous whole-script sudo invocation may have created a root-owned phase file.
if [[ -f "$TASK_STATE_DIR/setup-phase.txt" ]]; then
  sudo /usr/sbin/chown "$TASK_OWNER_UID:$TASK_OWNER_GID" "$TASK_STATE_DIR/setup-phase.txt"
fi
if /usr/bin/pgrep -x WeChat >/dev/null; then
  print 'WeChat is still running. Quit WeChat, then press Return here.'
  read -r TASK_CONTINUE
fi
if /usr/bin/pgrep -x WeChat >/dev/null; then
  print 'WeChat remains running; stopped without re-signing.'
  exit 1
fi
if [[ ! -d "$TASK_KEY_DIR/WeChat-original.app" ]]; then
  print 'Saving an owner-only copy of the original WeChat application.'
  /usr/bin/ditto "$TASK_WECHAT" "$TASK_KEY_DIR/WeChat-original.app"
fi
print 'Re-signing the authorized WeChat copy.'
if ! sudo /usr/bin/codesign --force --deep --sign - "$TASK_WECHAT"; then
  print 'SIGN_FAILED' > "$TASK_STATE_DIR/setup-phase.txt"
  print 'Signing was denied. Check Privacy & Security > App Management for the terminal app.'
  print 'Do not retry with sudo around the entire script or disable system protections.'
  exit 1
fi
/usr/bin/codesign --verify --deep --strict "$TASK_WECHAT"
print 'SIGNED' > "$TASK_STATE_DIR/setup-phase.txt"
print 'WeChat signing completed. Codex will restart WeChat and arm the capture.'
print 'Leave this terminal open. No further terminal input is needed.'
TASK_WAIT_START=$SECONDS
while [[ ! -f "$TASK_STATE_DIR/setup-go.txt" ]]; do
  if (( SECONDS - TASK_WAIT_START > 600 )); then
    print 'Timed out waiting for the supervised capture start; no key capture was attempted.'
    exit 1
  fi
  /bin/sleep 1
done
sudo "$TASK_ACQUIRE" preflight --json
print 'CAPTURING' > "$TASK_STATE_DIR/setup-phase.txt"
print 'Capture is starting. Log out of WeChat and log in again within ten minutes.'
sudo "$TASK_ACQUIRE" capture --output "$TASK_KEY_DIR/passphrase.txt" --timeout-seconds 600 --json
sudo /usr/sbin/chown "$TASK_OWNER_UID:$TASK_OWNER_GID" "$TASK_KEY_DIR/passphrase.txt"
chmod 600 "$TASK_KEY_DIR/passphrase.txt"
"$TASK_ACQUIRE" verify --passphrase-stdin < "$TASK_KEY_DIR/passphrase.txt"
"$TASK_CLI" source status
print 'CONNECTED' > "$TASK_STATE_DIR/setup-phase.txt"
print 'Database access verified. The key itself has not been displayed.'

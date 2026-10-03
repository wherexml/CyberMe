#!/bin/sh
set -eu
NATIVE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$NATIVE_ROOT/../.." && pwd)
APP_DIR="$REPO_ROOT/.local/apps/OpsTwin.app"
cd "$NATIVE_ROOT"
cargo build --release --locked
mkdir -p "$APP_DIR/Contents/MacOS"
cp target/release/opstwin "$APP_DIR/Contents/MacOS/opstwin"
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>opstwin</string>
<key>CFBundleIdentifier</key><string>local.opstwin.advance</string>
<key>CFBundleName</key><string>OpsTwin</string>
<key>CFBundleDisplayName</key><string>OpsTwin</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>0.1.0</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
printf '%s\n' "$APP_DIR"

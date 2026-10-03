#!/bin/sh
set -eu
NATIVE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$NATIVE_ROOT/../.." && pwd)
APP_DIR="$REPO_ROOT/.local/apps/OpsTwins.app"
cd "$NATIVE_ROOT"
cargo build --release --locked
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp target/release/opstwin "$APP_DIR/Contents/MacOS/opstwin"
swiftc -O assets/dictation.swift -o "$APP_DIR/Contents/MacOS/opstwin-dictation"
if [ -f assets/settings-permissions.swift ]; then
  swiftc -O assets/settings-permissions.swift -o "$APP_DIR/Contents/MacOS/opstwin-settings-permissions"
fi
ICONSET="$REPO_ROOT/.local/apps/OpsTwins.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" assets/opstwins.svg -o "$ICONSET/icon_${size}x${size}.png"
  double=$((size * 2))
  rsvg-convert -w "$double" -h "$double" assets/opstwins.svg -o "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/OpsTwins.icns"
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>opstwin</string>
<key>CFBundleIdentifier</key><string>local.opstwin.advance</string>
<key>CFBundleName</key><string>OpsTwins</string>
<key>CFBundleDisplayName</key><string>OpsTwins</string>
<key>CFBundleIconFile</key><string>OpsTwins.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>0.1.0</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>将你主动录制的语音转成消息草稿；取消后立即停止录音。</string>
</dict></plist>
PLIST
# Bind updated executable/resources for local execution. This is ad-hoc only, not Developer ID distribution.
codesign --force --deep --sign - "$APP_DIR"
printf '%s\n' "$APP_DIR"

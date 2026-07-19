#!/bin/zsh
# Builds thesis.app — the native macOS shell around the web app one level up.
set -euo pipefail
cd "${0:a:h}"

WEB_SRC=".."
BUILD="build"
APP="$BUILD/thesis.app"
CONTENTS="$APP/Contents"

rm -rf "$BUILD"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/web"

# ── web assets (sw.js deliberately excluded — no service worker in native) ──
cp "$WEB_SRC/index.html" "$WEB_SRC/styles.css" "$WEB_SRC/favicon.ico" "$WEB_SRC/manifest.json" "$CONTENTS/Resources/web/"
[ -f "$WEB_SRC/apple-touch-icon.png" ] && cp "$WEB_SRC/apple-touch-icon.png" "$CONTENTS/Resources/web/"
cp -R "$WEB_SRC/js" "$CONTENTS/Resources/web/js"

# ── native shim ──
cp shim/native-shim.js "$CONTENTS/Resources/"

# ── app icon: AppIcon-1024.png (margined, Dock-style) if present, else the PWA icon ──
ICON_SRC="AppIcon-1024.png"
[ -f "$ICON_SRC" ] || ICON_SRC="$WEB_SRC/android-chrome-512x512.png"
if [ -f "$ICON_SRC" ]; then
    ICONSET="$BUILD/AppIcon.iconset"
    mkdir -p "$ICONSET"
    for s in 16 32 128 256 512; do
        sips -z $s $s "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
        d=$((s * 2))
        sips -z $d $d "$ICON_SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
    done
    iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"
    rm -rf "$ICONSET"
fi

# ── Info.plist ──
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleExecutable</key><string>thesis</string>
    <key>CFBundleIdentifier</key><string>com.npyati.thesis</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>thesis</string>
    <key>CFBundleDisplayName</key><string>thesis</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# ── compile ──
swiftc -O \
    -target "$(uname -m)-apple-macos13.0" \
    Sources/*.swift \
    -o "$CONTENTS/MacOS/thesis"

codesign --force --sign - "$APP"
echo "Built $APP"

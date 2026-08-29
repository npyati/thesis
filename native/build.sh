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

# ── web assets ──
cp "$WEB_SRC/index.html" "$WEB_SRC/styles.css" "$WEB_SRC/favicon.ico" "$CONTENTS/Resources/web/"
cp -R "$WEB_SRC/js" "$CONTENTS/Resources/web/js"

# ── native shim ──
cp shim/native-shim.js "$CONTENTS/Resources/"

# ── margin companion (spawned by the shell for invited files) ──
mkdir -p "$CONTENTS/Resources/margin"
cp "$WEB_SRC/margin/margin.js" "$WEB_SRC/margin/PROTOCOL.md" "$WEB_SRC/margin/README.md" "$CONTENTS/Resources/margin/"

# ── app icon ──
ICON_SRC="AppIcon-1024.png"
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
    <key>CFBundleDocumentTypes</key>
    <array>
        <dict>
            <key>CFBundleTypeName</key><string>Markdown Document</string>
            <key>CFBundleTypeRole</key><string>Editor</string>
            <key>LSHandlerRank</key><string>Default</string>
            <key>LSItemContentTypes</key>
            <array>
                <string>net.daringfireball.markdown</string>
                <string>public.plain-text</string>
            </array>
        </dict>
    </array>
    <!-- macOS has no built-in markdown UTI; import the conventional one -->
    <key>UTImportedTypeDeclarations</key>
    <array>
        <dict>
            <key>UTTypeIdentifier</key><string>net.daringfireball.markdown</string>
            <key>UTTypeDescription</key><string>Markdown Document</string>
            <key>UTTypeConformsTo</key>
            <array><string>public.plain-text</string></array>
            <key>UTTypeTagSpecification</key>
            <dict>
                <key>public.filename-extension</key>
                <array><string>md</string><string>markdown</string></array>
                <key>public.mime-type</key>
                <array><string>text/markdown</string></array>
            </dict>
        </dict>
    </array>
</dict>
</plist>
PLIST

# ── compile ──
swiftc -O \
    -target "$(uname -m)-apple-macos13.0" \
    Sources/*.swift \
    -o "$CONTENTS/MacOS/thesis"

codesign --force --sign - "$APP"

# Tell LaunchServices about the (new) document-type claims right away
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" || true

echo "Built $APP"

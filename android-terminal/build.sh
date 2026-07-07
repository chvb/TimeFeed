#!/bin/bash
# TimeFeed Terminal — minimaler, reproduzierbarer APK-Build ohne Gradle,
# nur mit Android SDK build-tools (Muster: /opt/FotoFeed/android-webview).
# Erwartet ANDROID_HOME oder /opt/android-sdk sowie JDK (javac/keytool).

set -e
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-/opt/android-sdk}"
BUILD_TOOLS="$SDK/build-tools/35.0.0"
PLATFORM_JAR="$SDK/platforms/android-35/android.jar"

[ -d "$BUILD_TOOLS" ] || { echo "build-tools 35.0.0 nicht gefunden: $BUILD_TOOLS"; exit 1; }
[ -f "$PLATFORM_JAR" ] || { echo "android.jar fehlt: $PLATFORM_JAR"; exit 1; }

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"

APK_NAME="TimeFeed-Terminal.apk"
DOWNLOADS_DIR="/opt/TimeFeed/downloads"

# Release-Keystore im Projektordner (privates Repo — Passwort hier als
# Variable, gleiche Praxis wie in der FotoFeed-Vorlage). Der Keystore wird
# NICHT geloescht: gleiche Signatur bei jedem erneuten Build (Updates!).
KEYSTORE="timefeed-terminal.keystore"
KS_PASS="timefeed-terminal-2026"
KS_ALIAS="timefeedterminal"

BUILD=build
rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex"

echo ">>> Launcher-Icons pruefen"
if [ ! -f res/mipmap-xxxhdpi/ic_launcher.png ]; then
    python3 tools/gen_icons.py
fi

echo ">>> aapt2 compile (Ressourcen)"
"$AAPT2" compile --dir res -o "$BUILD/compiled_res.zip"

echo ">>> aapt2 link (unsigned APK)"
"$AAPT2" link \
    -I "$PLATFORM_JAR" \
    --manifest AndroidManifest.xml \
    -o "$BUILD/app-unsigned.apk" \
    -R "$BUILD/compiled_res.zip" \
    --auto-add-overlay

echo ">>> javac"
find src -name "*.java" > "$BUILD/sources.txt"
javac -source 1.8 -target 1.8 \
    -bootclasspath "$PLATFORM_JAR" \
    -classpath "$PLATFORM_JAR" \
    -d "$BUILD/classes" \
    @"$BUILD/sources.txt"

echo ">>> d8 (classes.dex)"
find "$BUILD/classes" -name "*.class" > "$BUILD/classlist.txt"
"$D8" --lib "$PLATFORM_JAR" --output "$BUILD/dex" @"$BUILD/classlist.txt"

echo ">>> classes.dex in APK einfuegen"
cp "$BUILD/app-unsigned.apk" "$BUILD/app-unaligned.apk"
python3 - "$BUILD/app-unaligned.apk" "$BUILD/dex/classes.dex" <<'PY'
import sys, zipfile, shutil
apk, dex = sys.argv[1], sys.argv[2]
tmp = apk + ".tmp"
with zipfile.ZipFile(apk, 'r') as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
    for item in src.infolist():
        if item.filename == 'classes.dex':
            continue
        dst.writestr(item, src.read(item.filename))
    dst.write(dex, 'classes.dex')
shutil.move(tmp, apk)
PY

echo ">>> zipalign"
"$ZIPALIGN" -p -f 4 "$BUILD/app-unaligned.apk" "$BUILD/app-aligned.apk"

echo ">>> Keystore pruefen/erzeugen"
if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair -v \
        -keystore "$KEYSTORE" \
        -storepass "$KS_PASS" -keypass "$KS_PASS" \
        -alias "$KS_ALIAS" \
        -dname "CN=TimeFeed Terminal, O=TimeFeed, C=DE" \
        -keyalg RSA -keysize 2048 -validity 10000
fi

echo ">>> apksigner sign"
"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-pass "pass:$KS_PASS" \
    --key-pass "pass:$KS_PASS" \
    --ks-key-alias "$KS_ALIAS" \
    --out "$APK_NAME" \
    "$BUILD/app-aligned.apk"

"$APKSIGNER" verify --print-certs "$APK_NAME" | head -5

echo ">>> Kopie nach $DOWNLOADS_DIR"
mkdir -p "$DOWNLOADS_DIR"
cp -f "$APK_NAME" "$DOWNLOADS_DIR/$APK_NAME"

echo ""
echo "APK fertig: $(pwd)/$APK_NAME"
ls -lh "$APK_NAME" "$DOWNLOADS_DIR/$APK_NAME"

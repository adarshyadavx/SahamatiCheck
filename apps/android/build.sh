#!/usr/bin/env bash
# Builds the SahamatiCheck Android app (a signed APK) with the Android SDK command-line tools only:
# aapt2 -> javac -> d8 -> zipalign -> apksigner. No Gradle and no downloads, so it also works offline.
#
#   apps/android/build.sh                      # -> apps/android/build/sahamaticheck.apk
#
# Needs: a JDK 11+ (JAVA_HOME or `java` on PATH) and an Android SDK with build-tools and one platform
# (ANDROID_HOME / ANDROID_SDK_ROOT, or the default %LOCALAPPDATA%\Android\Sdk on Windows).
#
# Signing: by default the standard debug key (~/.android/debug.keystore, created if missing). For a
# release you share widely, use your own key and keep it safe (every update must use the same one):
#   SIGN_KEYSTORE=my.jks SIGN_ALIAS=me SIGN_STOREPASS=... SIGN_KEYPASS=... apps/android/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/build"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-0.1.0}"
MIN_SDK=26
TARGET_SDK=34

# ---- locate the tools -------------------------------------------------------------------------
# Git Bash / MSYS hands Windows paths (C:Users...) through; convert them so globs work.
unixpath() { if command -v cygpath >/dev/null 2>&1 && [ -n "$1" ]; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
[ -n "${LOCALAPPDATA:-}" ] && LOCALAPPDATA="$(unixpath "$LOCALAPPDATA")"
[ -n "${ANDROID_HOME:-}" ] && ANDROID_HOME="$(unixpath "$ANDROID_HOME")"
[ -n "${ANDROID_SDK_ROOT:-}" ] && ANDROID_SDK_ROOT="$(unixpath "$ANDROID_SDK_ROOT")"
[ -n "${JAVA_HOME:-}" ] && JAVA_HOME="$(unixpath "$JAVA_HOME")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -n "${LOCALAPPDATA:-}" ]; then SDK="$LOCALAPPDATA/Android/Sdk"; fi
if [ -z "$SDK" ] && [ -d "$HOME/Android/Sdk" ]; then SDK="$HOME/Android/Sdk"; fi
[ -d "$SDK/build-tools" ] || { echo "Android SDK not found; set ANDROID_HOME" >&2; exit 1; }
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
PLATFORM="${ANDROID_PLATFORM:-$SDK/platforms/android-$TARGET_SDK}"
[ -f "$PLATFORM/android.jar" ] || PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)"
ANDROID_JAR="$PLATFORM/android.jar"

if [ -z "${JAVA_HOME:-}" ] && ! command -v javac >/dev/null 2>&1; then
  for d in "${LOCALAPPDATA:-/nonexistent}"/Programs/jdk-* "/c/Program Files/Java"/jdk-* "/c/Program Files/Eclipse Adoptium"/jdk-*; do
    if [ -x "$d/bin/javac" ] || [ -x "$d/bin/javac.exe" ]; then JAVA_HOME="$d"; fi
  done
fi
if [ -n "${JAVA_HOME:-}" ]; then export JAVA_HOME; export PATH="$JAVA_HOME/bin:$PATH"; fi
command -v javac >/dev/null 2>&1 || { echo "JDK not found; set JAVA_HOME" >&2; exit 1; }

EXE=""; BAT=""
if [ -f "$BT/aapt2.exe" ]; then EXE=".exe"; BAT=".bat"; fi
AAPT2="$BT/aapt2$EXE"; AAPT="$BT/aapt$EXE"; D8="$BT/d8$BAT"; ZIPALIGN="$BT/zipalign$EXE"; APKSIGNER="$BT/apksigner$BAT"
echo "build-tools: $(basename "$BT")   platform: $(basename "$PLATFORM")   java: $(javac -version 2>&1)"

# ---- build ------------------------------------------------------------------------------------
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

"$AAPT2" compile --dir "$ROOT/res" -o "$OUT/res.zip"
"$AAPT2" link -o "$OUT/app.unsigned.apk" -I "$ANDROID_JAR" \
  --manifest "$ROOT/AndroidManifest.xml" --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --auto-add-overlay "$OUT/res.zip"

SOURCES=()
while IFS= read -r f; do SOURCES+=("$f"); done < <(find "$ROOT/src" "$OUT/gen" -name '*.java')
javac -source 11 -target 11 -encoding UTF-8 -Xlint:-options -classpath "$ANDROID_JAR" -d "$OUT/classes" "${SOURCES[@]}"

CLASSES=()
while IFS= read -r f; do CLASSES+=("$f"); done < <(find "$OUT/classes" -name '*.class')
"$D8" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" "${CLASSES[@]}"

# add classes.dex at the root of the APK (aapt stores the path as given, so run it from the dex folder)
(cd "$OUT/dex" && "$AAPT" add "$OUT/app.unsigned.apk" classes.dex >/dev/null)
"$ZIPALIGN" -f -p 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

# ---- sign -------------------------------------------------------------------------------------
if [ -n "${SIGN_KEYSTORE:-}" ]; then
  KS="$SIGN_KEYSTORE"; ALIAS="${SIGN_ALIAS:?set SIGN_ALIAS}"
  STOREPASS="${SIGN_STOREPASS:?set SIGN_STOREPASS}"; KEYPASS="${SIGN_KEYPASS:-$STOREPASS}"
else
  KS="$HOME/.android/debug.keystore"; ALIAS="androiddebugkey"; STOREPASS="android"; KEYPASS="android"
  if [ ! -f "$KS" ]; then
    mkdir -p "$(dirname "$KS")"
    keytool -genkeypair -keystore "$KS" -storepass "$STOREPASS" -keypass "$KEYPASS" -alias "$ALIAS" \
      -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null
  fi
fi
"$APKSIGNER" sign --ks "$KS" --ks-key-alias "$ALIAS" --ks-pass "pass:$STOREPASS" --key-pass "pass:$KEYPASS" \
  --out "$OUT/sahamaticheck.apk" "$OUT/app.aligned.apk"
"$APKSIGNER" verify "$OUT/sahamaticheck.apk"
rm -f "$OUT/sahamaticheck.apk.idsig"

echo "built: $OUT/sahamaticheck.apk ($(wc -c < "$OUT/sahamaticheck.apk") bytes)"

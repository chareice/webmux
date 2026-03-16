#!/usr/bin/env bash
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/.local/share/android-sdk}}"
TARGET="${1:-device}"
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$APP_ROOT/android"
GRADLEW="$ANDROID_DIR/gradlew"
PREPARE_GOOGLE_SERVICES="$APP_ROOT/scripts/prepare-google-services.sh"
ARCHITECTURES=""

case "$TARGET" in
  device)
    ARCHITECTURES="arm64-v8a"
    ;;
  emulator)
    ARCHITECTURES="x86_64"
    ;;
  universal)
    ARCHITECTURES=""
    ;;
  *)
    echo "Usage: $0 [device|emulator|universal]" >&2
    exit 1
    ;;
esac

if [[ ! -x "$GRADLEW" ]]; then
  echo "Gradle wrapper not found at $GRADLEW" >&2
  exit 1
fi

"$PREPARE_GOOGLE_SERVICES"

cd "$ANDROID_DIR"

GRADLE_ARGS=(
  app:assembleDebug
  --no-daemon
  --console=plain
)

if [[ -n "$ARCHITECTURES" ]]; then
  GRADLE_ARGS+=("-PreactNativeArchitectures=$ARCHITECTURES")
fi

ANDROID_HOME="$SDK_ROOT" \
ANDROID_SDK_ROOT="$SDK_ROOT" \
"$GRADLEW" "${GRADLE_ARGS[@]}"

echo "Built $ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"

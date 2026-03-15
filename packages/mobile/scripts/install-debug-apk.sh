#!/usr/bin/env bash
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/.local/share/android-sdk}}"
ADB_BIN="$SDK_ROOT/platform-tools/adb"
APK_PATH="${1:-$(cd "$(dirname "$0")/.." && pwd)/android/app/build/outputs/apk/debug/app-debug.apk}"
PACKAGE_NAME="site.chareice.webmux"
ACTIVITY_NAME=".MainActivity"

if [[ ! -x "$ADB_BIN" ]]; then
  echo "adb not found at $ADB_BIN" >&2
  exit 1
fi

if [[ ! -f "$APK_PATH" ]]; then
  echo "APK not found at $APK_PATH" >&2
  exit 1
fi

"$ADB_BIN" wait-for-device

DEVICE_ABI="$("$ADB_BIN" shell getprop ro.product.cpu.abi | tr -d '\r')"
if command -v unzip >/dev/null 2>&1 && [[ -n "$DEVICE_ABI" ]]; then
  APK_CONTENTS="$(unzip -Z1 "$APK_PATH")"
  if ! grep -Fq "lib/$DEVICE_ABI/libreactnative.so" <<<"$APK_CONTENTS"; then
    echo "APK $APK_PATH does not include libreactnative.so for ABI $DEVICE_ABI" >&2
    if [[ "$DEVICE_ABI" == "x86_64" ]]; then
      echo "Build an emulator APK first: pnpm android:build-debug:emulator" >&2
    elif [[ "$DEVICE_ABI" == "arm64-v8a" ]]; then
      echo "Build a device APK first: pnpm android:build-debug:device" >&2
    fi
    exit 1
  fi
fi

"$ADB_BIN" install -r "$APK_PATH"
"$ADB_BIN" reverse tcp:8082 tcp:8082 >/dev/null 2>&1 || true
"$ADB_BIN" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME" >/dev/null 2>&1 || true

echo "Installed $APK_PATH"

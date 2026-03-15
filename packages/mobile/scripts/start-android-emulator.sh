#!/usr/bin/env bash
set -euo pipefail

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/.local/share/android-sdk}}"
AVD_NAME="${WEBMUX_ANDROID_AVD:-webmux-api36}"
SYSTEM_IMAGE="${WEBMUX_ANDROID_IMAGE:-system-images;android-36;google_apis;x86_64}"
DEVICE_NAME="${WEBMUX_ANDROID_DEVICE:-pixel_8}"
ANDROID_CONFIG_HOME="${ANDROID_EMULATOR_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/.android}"
ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$ANDROID_CONFIG_HOME/avd}"
EMULATOR_BIN="$SDK_ROOT/emulator/emulator"
ADB_BIN="$SDK_ROOT/platform-tools/adb"
AVDMANAGER_BIN="$SDK_ROOT/cmdline-tools/latest/bin/avdmanager"

if [[ ! -x "$EMULATOR_BIN" ]]; then
  echo "Android emulator not found at $EMULATOR_BIN" >&2
  exit 1
fi

if [[ ! -x "$ADB_BIN" ]]; then
  echo "adb not found at $ADB_BIN" >&2
  exit 1
fi

if [[ ! -x "$AVDMANAGER_BIN" ]]; then
  echo "avdmanager not found at $AVDMANAGER_BIN" >&2
  exit 1
fi

export ANDROID_EMULATOR_HOME="$ANDROID_CONFIG_HOME"
export ANDROID_AVD_HOME

mkdir -p "$ANDROID_AVD_HOME"

AVD_DIR="$ANDROID_AVD_HOME/${AVD_NAME}.avd"
CONFIG_FILE="$AVD_DIR/config.ini"

if [[ ! -d "$AVD_DIR" ]]; then
  echo "Creating AVD $AVD_NAME..."
  echo "no" | "$AVDMANAGER_BIN" create avd -n "$AVD_NAME" -k "$SYSTEM_IMAGE" -d "$DEVICE_NAME"
fi

set_config() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$CONFIG_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$CONFIG_FILE"
  else
    echo "${key}=${value}" >> "$CONFIG_FILE"
  fi
}

set_config "hw.keyboard" "yes"
set_config "disk.dataPartition.size" "8G"
set_config "hw.gpu.enabled" "yes"
set_config "hw.gpu.mode" "host"

if "$ADB_BIN" devices | grep -q 'emulator-.*device'; then
  echo "An emulator is already running."
  "$ADB_BIN" reverse tcp:8082 tcp:8082 >/dev/null 2>&1 || true
  exit 0
fi

echo "Starting emulator $AVD_NAME..."
"$EMULATOR_BIN" -avd "$AVD_NAME" -gpu host -netdelay none -netspeed full "$@"

#!/usr/bin/env bash
set -euo pipefail
apk="$1"
mkdir -p android-smoke
sdkmanager 'emulator' 'system-images;android-35;default;x86_64' >/dev/null
printf 'no\n' | avdmanager create avd --force --name offdesk-smoke --package 'system-images;android-35;default;x86_64' >/dev/null
sudo chmod a+rw /dev/kvm
"$ANDROID_HOME/emulator/emulator" -avd offdesk-smoke -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect >android-smoke/emulator.log 2>&1 &
emulator_pid=$!
trap 'kill "$emulator_pid" 2>/dev/null || true' EXIT
adb wait-for-device
timeout 180 bash -c 'until [[ "$(adb shell getprop sys.boot_completed | tr -d "\r")" == "1" ]]; do sleep 1; done'
adb shell input keyevent 82
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
python3 scripts/android-startup-smoke.py "$apk"

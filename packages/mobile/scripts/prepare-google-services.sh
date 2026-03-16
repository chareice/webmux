#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_PATH="$APP_ROOT/android/app/google-services.json"

if [[ -n "${ANDROID_GOOGLE_SERVICES_JSON_BASE64:-}" ]]; then
  printf '%s' "$ANDROID_GOOGLE_SERVICES_JSON_BASE64" | base64 --decode > "$TARGET_PATH"
  echo "Wrote $TARGET_PATH from ANDROID_GOOGLE_SERVICES_JSON_BASE64"
  exit 0
fi

if [[ -f "$TARGET_PATH" ]]; then
  echo "Using existing $TARGET_PATH"
  exit 0
fi

echo "google-services.json is not configured. Android push notifications will stay disabled."

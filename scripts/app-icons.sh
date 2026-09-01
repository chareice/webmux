#!/usr/bin/env bash
# Regenerate the Android launcher icons from packages/desktop/icon/*.svg.
#
#   scripts/app-icons.sh
#
# Three sources, because Android asks for three things:
#   icon.svg            black square, wordmark at 80% — the legacy icon
#   icon-round.svg      black circle, wordmark at 74% — the legacy round icon
#   icon-foreground.svg transparent, wordmark at 61% — the adaptive foreground,
#                       61% being the central 66 of 108dp that every mask keeps
#
# Needs rsvg-convert (brew install librsvg).

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/packages/desktop/icon"
res="$root/packages/desktop/src-tauri/gen/android/app/src/main/res"

command -v rsvg-convert >/dev/null || {
    echo "rsvg-convert is required: brew install librsvg" >&2
    exit 1
}

# density: legacy size, adaptive foreground size (108dp at that density)
for entry in "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"; do
    set -- $entry
    density="$1" legacy="$2" foreground="$3"
    dir="$res/mipmap-$density"
    mkdir -p "$dir"
    rsvg-convert -w "$legacy" -h "$legacy" "$src/icon.svg" -o "$dir/ic_launcher.png"
    rsvg-convert -w "$legacy" -h "$legacy" "$src/icon-round.svg" -o "$dir/ic_launcher_round.png"
    rsvg-convert -w "$foreground" -h "$foreground" "$src/icon-foreground.svg" -o "$dir/ic_launcher_foreground.png"
    echo "$density: ${legacy}px legacy, ${foreground}px foreground"
done

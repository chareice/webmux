#!/usr/bin/env bash
# Vectorise a flat-colour logo PNG into an SVG with potrace.
#
#   scripts/logo-to-svg.sh <input.png> <output.svg> [fill-hex]
#
# Assumes the source is a solid mark on a solid background, which is what a
# wordmark export is. Thresholds to bilevel, traces, then paints the result
# with the brand colour. Needs potrace (brew install potrace).

set -euo pipefail

SRC="${1:?usage: logo-to-svg.sh <input.png> <output.svg> [fill-hex] [blacklevel]}"
OUT="${2:?usage: logo-to-svg.sh <input.png> <output.svg> [fill-hex] [blacklevel]}"
FILL="${3:-#1A5FE8}"
# potrace splits ink from ground at this luma (0..1). Its 0.5 default sits
# well below the midpoint between a mid-tone mark and a near-white ground,
# so it cuts inside the outline and erodes the glyphs by a fraction of a
# pixel. Pass the real midpoint between your two colours instead.
BLACKLEVEL="${4:-0.5}"

command -v potrace >/dev/null || { echo "error: potrace not found (brew install potrace)" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# PNG -> PBM. sips has no PNM backend, so go via BMP, which potrace reads.
# -Z upscales first: tracing a larger bitmap puts the curve fit on more
# sample points, so the outlines come back smoother.
sips -s format bmp -Z 4096 "$SRC" --out "$TMP/big.bmp" >/dev/null 2>&1

# --invert because potrace traces black-on-white; a dark mark on a light
# ground already reads correctly, a light mark on dark needs flipping.
# Detect which by sampling the corner pixel.
CORNER_IS_DARK=$(sips -g pixelWidth "$TMP/big.bmp" >/dev/null 2>&1; python3 - "$TMP/big.bmp" <<'PY'
import sys,struct
f=open(sys.argv[1],'rb').read()
off=struct.unpack('<I',f[10:14])[0]
bpp=struct.unpack('<H',f[28:30])[0]//8
px=f[off:off+bpp]
print(1 if sum(px[:3])/3 < 128 else 0)
PY
)

TRACE_ARGS=(--svg --turdsize 2 --alphamax 1 --opttolerance 0.2 --blacklevel "$BLACKLEVEL")
if [ "$CORNER_IS_DARK" = "1" ]; then
  TRACE_ARGS+=(--invert)
fi

potrace "${TRACE_ARGS[@]}" -o "$TMP/traced.svg" "$TMP/big.bmp"

# potrace paints fill="#000000" and wraps everything in a flipping transform.
# Recolour, and drop the XML prolog/comments so the file drops into a page.
python3 - "$TMP/traced.svg" "$OUT" "$FILL" <<'PY'
import re,sys
src,dst,fill = sys.argv[1],sys.argv[2],sys.argv[3]
s = open(src).read()
s = re.sub(r'<\?xml[^>]*\?>\s*','',s)
s = re.sub(r'<!DOCTYPE[^>]*>\s*','',s)
s = re.sub(r'<!--.*?-->\s*','',s,flags=re.S)
s = s.replace('fill="#000000"', f'fill="{fill}"')
if 'fill=' not in s.split('>')[1]:
    s = s.replace('<g ', f'<g fill="{fill}" ',1)
s = s.replace('<svg ', '<svg role="img" aria-label="offdesk" ',1)
open(dst,'w').write(s)
PY

echo "wrote $OUT"
grep -o 'viewBox="[^"]*"' "$OUT" | head -1
printf 'paths: %s   bytes: %s\n' "$(grep -o '<path' "$OUT" | wc -l | tr -d ' ')" "$(wc -c < "$OUT" | tr -d ' ')"

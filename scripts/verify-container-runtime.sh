#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:-webmux-runtime-smoke}"

docker build -t "$IMAGE_TAG" .

docker run --rm --entrypoint sh "$IMAGE_TAG" -lc '
  /usr/local/bin/webmux-server --help >/tmp/webmux-help.txt 2>&1
  code=$?
  cat /tmp/webmux-help.txt
  exit "$code"
'

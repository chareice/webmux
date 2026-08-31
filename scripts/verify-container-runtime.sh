#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:-offdesk-runtime-smoke}"

docker build -t "$IMAGE_TAG" .

docker run --rm --entrypoint sh "$IMAGE_TAG" -lc '
  /usr/local/bin/offdesk-hub --help >/tmp/offdesk-help.txt 2>&1
  code=$?
  cat /tmp/offdesk-help.txt
  exit "$code"
'

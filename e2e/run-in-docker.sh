#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f e2e/docker-compose.yml)

cleanup() {
  "${compose[@]}" down --remove-orphans
}

trap cleanup EXIT

"$(dirname "$0")/prepare-zellij-certs.sh"

"${compose[@]}" down --remove-orphans
"${compose[@]}" up --build --abort-on-container-exit --exit-code-from runner runner

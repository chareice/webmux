# Environment Playbook

## Architecture

- **Hub** (`webmux-server`): Axum web server on port 4317. Serves REST API, WebSocket endpoints, and static frontend. SQLite database. Runs in `WEBMUX_DEV_MODE=true` for E2E (skip OAuth, allow unauthenticated nodes).
- **Node** (`webmux-node`): Machine daemon connecting to hub via `ws://hub:4317/ws/machine`. Manages real PTY sessions with bash. Runs with `--id e2e-node` (dev mode, no registration needed).
- **Database:** SQLite at `/app/data/tc.db` (ephemeral per test run, no volume mount)

## Data Access

Methods available for test data setup:

- **API route definitions:** `crates/hub/src/routes/` — read these at runtime to find current endpoints
- **Dev login:** `GET /api/auth/dev` returns `{ token }` — use this to authenticate in tests
- **WebSocket endpoints:**
  - `/ws/machine` — node ↔ hub
  - `/ws/terminal/{machine_id}/{terminal_id}?token=<jwt>` — browser ↔ terminal I/O
  - `/ws/events?token=<jwt>` — browser event subscription (machine online/offline, terminal created/destroyed)

## Logging

How to access service logs for debugging:

- **Hub:** `docker compose -f e2e/docker-compose.yml logs hub --tail 100`
- **Node:** `docker compose -f e2e/docker-compose.yml logs node --tail 100`
- **All:** `docker compose -f e2e/docker-compose.yml logs --tail 200`

## Startup Checklist

1. Build binaries: `cargo build --release --bin webmux-server --bin webmux-node && pnpm build`
2. Build and start services: `docker compose -f e2e/docker-compose.yml up -d --build`
3. Wait for hub health: hub has built-in healthcheck (3s interval, 10 retries on `GET /api/auth/dev`)
4. Verify node connected: `docker compose -f e2e/docker-compose.yml logs hub` — look for "Machine e2e-node registered"
5. Test dev login: `curl -sf http://localhost:4317/api/auth/dev`
6. Teardown: `docker compose -f e2e/docker-compose.yml down`

## Known Issues

- **GLIBC version**: E2E Dockerfiles use `debian:trixie-slim` (not bookworm) because host-compiled binaries (Arch Linux) require GLIBC ≥ 2.39. If binaries are compiled on a different host, adjust the base image accordingly.
- **tmux not available in node container**: Node warns "tmux not found" — terminal sessions won't persist across container restarts, which is fine for E2E testing.

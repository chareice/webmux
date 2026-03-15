# Webmux

Webmux is a mobile-first control plane for `tmux` across your own machines.

You run the central server somewhere you control, register one or more remote agents, open the web UI from your phone or laptop, pick a machine, then attach to a real terminal backed by that machine's local `tmux` socket and PTY. The `tmux` session stays alive on the agent after the browser disconnects.

## What it does today

- Authenticates users with GitHub, Google, or dev mode
- Registers remote agents with one-time enrollment tokens
- Lists your agents and shows online or offline state
- Lists `tmux` sessions for each connected agent
- Creates and kills sessions with agent-side confirmation
- Shows pane previews, current command, activity time, and unread indicators
- Opens a live terminal over WebSocket with reconnect handling
- Adds mobile shortcut keys like `Esc`, `Prefix`, arrows, `Ctrl+C`, and `Detach`
- Keeps the terminal process on the agent machine, not in the browser

## Stack

- Frontend: React 19 + Vite + xterm.js
- Backend: Fastify + bare `ws`
- Persistence: SQLite via `better-sqlite3`
- Agent runtime: Node.js CLI + `node-pty`
- Session engine: `tmux`

## Why this shape

- `tmux` is the source of truth for session lifetime
- `node-pty` gives the browser a real PTY, so `vim`, `fzf`, `htop`, and similar TUI apps work
- The server stays focused on auth, enrollment, routing, and fan-out instead of owning terminal state
- The WebSocket layer is kept small and explicit instead of hiding it behind a larger framework abstraction
- The heavy terminal renderer is lazy-loaded so the session list stays fast on mobile

## Prerequisites

- Node.js 20+
- `pnpm`
- `tmux`
- Build toolchain for native modules
  - `python3`
  - `make`
  - `g++`

## Run locally

```bash
pnpm install
pnpm dev
```

This starts:

- Vite on `http://127.0.0.1:5173`
- The API/WebSocket server on `http://127.0.0.1:4317`

In local dev, the server enables `/api/auth/dev` and the UI can auto-login as a temporary admin user.

## Build and run

```bash
pnpm build
pnpm start
```

## Deploy with Docker

Pushes to `main` publish a server image to `ghcr.io/chareice/webmux-server`.

```bash
docker compose pull
docker compose up -d
```

The checked-in `docker-compose.yml` follows the same image-based deployment model used on NAS and is compatible with Watchtower.

If the repository stays private, the first GHCR package will also be private by default. In that case the server host must authenticate to `ghcr.io` before `docker compose pull`, and Watchtower also needs access to the same registry credentials. If you switch the GHCR package visibility to public, NAS can pull updates anonymously and Watchtower can update it without extra secrets.

## Environment variables

```bash
PORT=4317
JWT_SECRET=change-me
WEBMUX_BASE_URL=https://webmux.example.com
DATABASE_PATH=./webmux.db
WEBMUX_AGENT_PACKAGE_NAME=@webmux/agent
WEBMUX_AGENT_TARGET_VERSION=
WEBMUX_AGENT_MIN_VERSION=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

`WEBMUX_AGENT_TARGET_VERSION` is the recommended agent release for managed upgrades.
`WEBMUX_AGENT_MIN_VERSION` is the oldest agent version the server will accept.
If both are empty, the server does not advertise or enforce agent upgrades.

## Managed Agent Service

Register the machine once, then either run it manually or install the managed user service:

```bash
pnpm dlx @webmux/agent register \
  --server https://webmux.example.com \
  --token <registration-token> \
  --name my-nas

pnpm dlx @webmux/agent start
pnpm dlx @webmux/agent service install
```

The managed service keeps a pinned agent runtime under `~/.webmux/releases/<version>` and points the systemd unit at that exact release. It does not run `latest` on startup and it does not depend on a global install.

When the server advertises a newer `WEBMUX_AGENT_TARGET_VERSION`, a managed service with auto-upgrade enabled will install that exact version, rewrite the unit, and restart itself. Manual `start` runs never mutate themselves; they only log the recommended upgrade command.

To switch a managed agent to a specific version manually:

```bash
pnpm dlx @webmux/agent service upgrade --to 0.1.5
```

## API surface

- `GET /api/health`
- `GET /api/auth/me`
- `GET /api/auth/github`
- `GET /api/auth/google`
- `GET /api/auth/dev` (dev only)
- `GET /api/agents`
- `POST /api/agents/register-token`
- `POST /api/agents/register`
- `PATCH /api/agents/:id`
- `DELETE /api/agents/:id`
- `GET /api/agents/:id/sessions`
- `POST /api/agents/:id/sessions`
- `DELETE /api/agents/:id/sessions/:name`
- `WS /ws/agent`
- `WS /ws/events?token=<jwt>`
- `WS /ws/terminal?agent=<id>&session=<name>&token=<jwt>`

## Development commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Notes

- The agent uses a dedicated `tmux` socket name (`webmux`) so it does not need to share state with your personal terminal sessions unless you want it to.
- Session names are intentionally constrained to a small safe charset.
- Session list updates are pushed immediately on create, kill, attach, and detach, with periodic agent refresh to keep previews and activity markers current.
- Agent upgrades are server-owned policy, not npm `latest`. Set `WEBMUX_AGENT_TARGET_VERSION` and `WEBMUX_AGENT_MIN_VERSION` during server deploys when you want to roll out or enforce a new agent release.
- The container publish workflow pushes `ghcr.io/chareice/webmux-server:main`, `:latest`, and `:sha-<commit>` on every `main` push.
- The current UI is optimized for single-pane attach flows. Multi-pane map views, thumbnails, auth policies, and ACLs are still future work.

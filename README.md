# Webmux

Webmux is a mobile-first web client for `tmux`.

You run the server on a machine you control, open the web UI from your phone, pick a session, and attach to a real terminal backed by `tmux` and a PTY. The session stays alive on the server after the browser disconnects.

## What it does today

- Lists `tmux` sessions from a dedicated socket namespace
- Creates and kills sessions
- Shows a small pane preview for each session
- Opens a live terminal over WebSocket
- Adds mobile shortcut keys like `Esc`, `Prefix`, arrows, `Ctrl+C`, and `Detach`
- Keeps the terminal process on the server, not in the browser

## Stack

- Frontend: React 19 + Vite + xterm.js
- Backend: Fastify + bare `ws`
- Terminal bridge: `node-pty`
- Session engine: `tmux`

## Why this shape

- `tmux` is the source of truth for session lifetime
- `node-pty` gives the browser a real PTY, so `vim`, `fzf`, `htop`, and similar TUI apps work
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

## Build and run

```bash
pnpm build
pnpm start
```

## Environment variables

```bash
HOST=0.0.0.0
PORT=4317
WEBMUX_TMUX_SOCKET=webmux
WEBMUX_WORKSPACE_ROOT=/path/to/default/session/cwd
```

## API surface

- `GET /api/health`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `WS /ws/terminal?session=<name>`

## Development commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Notes

- The server uses a dedicated `tmux` socket name (`webmux` by default) so it does not need to share state with your personal terminal sessions unless you want it to.
- Session names are intentionally constrained to a small safe charset.
- The current UI is optimized for single-pane attach flows. Multi-pane map views, thumbnails, auth, and ACLs are still future work.

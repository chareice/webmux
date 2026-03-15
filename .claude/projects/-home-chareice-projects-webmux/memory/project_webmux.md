---
name: webmux-project-context
description: Webmux project architecture, deployment, and current state
type: project
---

Webmux is a web-based terminal manager with C/S architecture.

**Architecture:**
- `@webmux/server` — public relay server (Fastify + SQLite + GitHub/Google OAuth + JWT)
- `@webmux/agent` — machine-side CLI (tmux + node-pty, connects to server via WebSocket)
- `@webmux/web` — React frontend (login, agent list, terminal sessions)
- `@webmux/shared` — shared TypeScript contracts

**Deployment:**
- Server runs on NAS (Synology DS920+) via Docker (node:latest + npm install @webmux/server)
- URL: https://webmux.nas.chareice.site
- Caddy reverse proxy on NAS
- CI: GitHub Actions builds and publishes to npm on push to main
- Agent auto-updates via server-driven version check

**Key credentials (in NAS docker-compose):**
- GitHub OAuth App for login
- Google OAuth for login
- JWT secret for auth

**Why:** Primary use case is mobile phone remote control of terminal sessions (Codex, Claude Code) across multiple machines.

**How to apply:** When working on webmux, always consider mobile UX as the primary target. Desktop is secondary.

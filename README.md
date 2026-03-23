# Webmux

Webmux is an AI coding control plane for your own machines.

You register one or more remote agents, connect a repository on that machine,
start coding threads with Claude Code or Codex, and manage longer-running work
through projects and tasks. The same Expo app powers both the web UI and the
Android app.

## What it does today

- Authenticates users with GitHub, Google, or dev mode
- Registers remote agents with one-time enrollment tokens
- Starts coding threads against a selected repository and tool
- Streams structured timeline updates for thread runs in real time
- Groups work into projects with queued tasks and project actions
- Manages global LLM settings and per-agent instruction files
- Sends Android push notifications when a thread turn finishes
- Serves the web app from the same Rust server that handles the API and WebSockets

## Stack

- Frontend: Expo + Expo Router + React Native Web + NativeWind
- Backend: Rust + Axum
- Agent runtime: Rust CLI on your own machines
- Persistence: SQLite
- Realtime: WebSockets for agents, threads, and projects

## Prerequisites

- Node.js 22+
- `pnpm`
- Rust toolchain

## Run locally

```bash
pnpm install
pnpm dev
```

This starts the Expo web app.

For Android development:

```bash
pnpm dev:android
```

The Rust server still runs separately during local development. In dev mode the
server enables `/api/auth/dev`, and the app can auto-login with a temporary
account.

## Checks

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

`pnpm build` exports the web app to `packages/app/dist`.

## Deploy with Docker

Pushes to `main` publish a server image to `ghcr.io/chareice/webmux-server`.
The production image includes the Expo web export and the Rust server binary.

```bash
docker compose pull
docker compose up -d
```

The checked-in `docker-compose.yml` matches the deployment model used on NAS and
is compatible with Watchtower.

## Android releases

Publishing a GitHub release, or running the `Build Android Release` workflow
manually, builds the Android app from `packages/app` and uploads both APK and
AAB artifacts.

Push notifications require Firebase config for both the Android app build and
the server:

- `ANDROID_GOOGLE_SERVICES_JSON_BASE64` for the Android release workflow
- `WEBMUX_FIREBASE_SERVICE_ACCOUNT_BASE64` for the server

If Android release metadata is not set explicitly, the server can still fall
back to the latest GitHub release when the app checks for updates.

## Environment variables

```bash
PORT=4317
HOST=0.0.0.0
JWT_SECRET=change-me
DATABASE_PATH=./webmux.db
WEBMUX_BASE_URL=https://webmux.example.com

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

WEBMUX_AGENT_PACKAGE_NAME=@webmux/agent
WEBMUX_AGENT_TARGET_VERSION=
WEBMUX_AGENT_MIN_VERSION=

WEBMUX_FIREBASE_SERVICE_ACCOUNT_BASE64=
WEBMUX_MOBILE_LATEST_VERSION=
WEBMUX_MOBILE_DOWNLOAD_URL=
WEBMUX_MOBILE_MIN_VERSION=
```

## Managed agent service

Register a machine once, then run the agent manually or install the managed
user service:

```bash
pnpm dlx @webmux/agent register \
  --server https://webmux.example.com \
  --token <registration-token> \
  --name my-nas

pnpm dlx @webmux/agent start
pnpm dlx @webmux/agent service install
```

When the server advertises a newer target version, managed agents can upgrade to
that exact release. Manual `start` runs do not mutate themselves.

## API surface

- `GET /api/auth/me`
- `GET /api/auth/github`
- `GET /api/auth/google`
- `GET /api/auth/dev`
- `GET /api/agents`
- `POST /api/agents/register-token`
- `POST /api/agents/register`
- `PATCH /api/agents/:id`
- `DELETE /api/agents/:id`
- `GET /api/agents/:id/repositories`
- `GET /api/threads`
- `GET /api/agents/:id/threads`
- `POST /api/agents/:id/threads`
- `POST /api/agents/:id/threads/:threadId/turns`
- `POST /api/agents/:id/threads/:threadId/interrupt`
- `PATCH /api/agents/:id/threads/:threadId/turns/:turnId`
- `DELETE /api/agents/:id/threads/:threadId`
- `GET /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/tasks/:taskId/messages`
- `POST /api/projects/:id/tasks/:taskId/messages`
- `GET /api/projects/:id/actions`
- `POST /api/mobile/push-devices`
- `DELETE /api/mobile/push-devices/:installationId`
- `GET /api/mobile/version`
- `WS /ws/agent`
- `WS /ws/thread`
- `WS /ws/project`

## Notes

- The unified Expo app is now the only frontend client in this repository.
- The web app and Android app share the same UI and business logic in
  `packages/app`.
- The container publish workflow pushes `ghcr.io/chareice/webmux-server:main`,
  `:latest`, and `:sha-<commit>` on every `main` push.

# Webmux C/S Architecture Design

## Overview

Refactor webmux from a single-machine app into a client-server architecture:

- **Server** (public internet): Web frontend hosting + API + auth + relay
- **Agent** (user's machines): Runs tmux/node-pty, connects to Server
- **Web** (browser): React frontend, talks to Server only

One Server manages multiple Agents across multiple users. Each Agent belongs to the user who registered it.

## Architecture

```
Browser (Web)          Server (Public)           Agent (Machine)
┌─────────────┐        ┌──────────────┐          ┌─────────────┐
│ React + xterm│◄─WS──►│ Relay + Auth │◄───WS───►│ tmux + pty  │
│             │  HTTPS │ SQLite       │          │             │
│ Login page  │        │ GitHub OAuth │          │ CLI tool    │
│ Agent list  │        │ JWT          │          │ Credentials │
│ Sessions    │        │ Agent hub    │          │ Auto-reconnect│
└─────────────┘        └──────────────┘          └─────────────┘
```

### Data Flow (terminal I/O)

```
Keyboard → Browser WS → Server relay → Agent WS → node-pty → tmux
tmux → node-pty → Agent WS → Server relay → Browser WS → xterm
```

Server is a stateless relay for terminal data. It does not run tmux or node-pty.

## Authentication

### User Auth: GitHub OAuth

Login flow:
1. Browser clicks "Login with GitHub"
2. Redirect to GitHub OAuth authorization page
3. GitHub callback to Server `/api/auth/github/callback?code=xxx`
4. Server exchanges code for access_token, fetches GitHub user info
5. Server finds/creates user in SQLite, issues JWT
6. Redirect to frontend with JWT

Rules:
- First GitHub user to log in becomes admin
- Admin controls a whitelist of allowed GitHub usernames
- Non-whitelisted users are rejected after OAuth

Dev mode (`WEBMUX_DEV_MODE=true`):
- No GitHub OAuth config needed
- `/api/auth/dev` endpoint auto-issues JWT for a built-in dev admin user
- Console warning on startup

Environment variables (production):
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `JWT_SECRET`
- `WEBMUX_BASE_URL` (for OAuth callback)

### Agent Auth: Registration Token → Long-lived Credential

Registration flow (inspired by GitHub Actions self-hosted runner):

1. User clicks "Add Agent" in Web UI → enters agent name
2. Server generates a one-time registration token (1 hour TTL)
3. UI displays the registration command
4. User runs on target machine:
   ```bash
   webmux-agent register \
     --server https://webmux.example.com \
     --token <registration-token> \
     --name my-nas
   ```
5. Agent sends token to Server API
6. Server validates token (one-time, consumed on use)
7. Server issues long-lived credential (agentId + agentSecret)
8. Agent saves to `~/.webmux/credentials.json`

Subsequent connections:
```bash
webmux-agent start
# Reads local credentials → WebSocket to Server → auth → online
```

## Database Schema (SQLite)

```sql
users (
  id              TEXT PRIMARY KEY,
  github_id       INTEGER UNIQUE NOT NULL,
  github_login    TEXT NOT NULL,
  avatar_url      TEXT,
  role            TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  created_at      INTEGER NOT NULL
)

agents (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  name                TEXT NOT NULL,
  agent_secret_hash   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'offline',  -- 'online' | 'offline'
  last_seen_at        INTEGER,
  created_at          INTEGER NOT NULL
)

registration_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  agent_name  TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
)
```

## WebSocket Protocol

### Three channels

| Path | Direction | Purpose |
|---|---|---|
| `/ws/agent` | Agent → Server | Agent online, heartbeat, session sync, terminal data upstream |
| `/ws/terminal` | Browser → Server | Terminal I/O, Server relays to Agent |
| `/ws/events` | Browser → Server | Real-time session list push |

### Agent ↔ Server Messages

```typescript
// Agent → Server
type AgentMessage =
  | { type: 'auth'; agentId: string; agentSecret: string }
  | { type: 'heartbeat' }
  | { type: 'sessions-sync'; sessions: SessionSummary[] }
  | { type: 'terminal-output'; browserId: string; data: string }
  | { type: 'terminal-ready'; browserId: string; sessionName: string }
  | { type: 'terminal-exit'; browserId: string; exitCode: number }
  | { type: 'error'; browserId?: string; message: string }

// Server → Agent
type ServerToAgentMessage =
  | { type: 'auth-ok' }
  | { type: 'auth-fail'; message: string }
  | { type: 'sessions-list' }
  | { type: 'terminal-attach'; browserId: string; sessionName: string; cols: number; rows: number }
  | { type: 'terminal-detach'; browserId: string }
  | { type: 'terminal-input'; browserId: string; data: string }
  | { type: 'terminal-resize'; browserId: string; cols: number; rows: number }
  | { type: 'session-create'; name: string }
  | { type: 'session-kill'; name: string }
```

### Browser ↔ Server Messages (unchanged from current)

```typescript
// Browser → Server
type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// Server → Browser
type TerminalServerMessage =
  | { type: 'ready'; sessionName: string }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
```

Browser connects to `/ws/terminal?agent=<agentId>&session=<name>&cols=N&rows=N`. Server assigns a `browserId` internally and manages the mapping.

### Connection Lifecycle

```
Agent starts
  → connects /ws/agent
  → sends { type: 'auth', agentId, agentSecret }
  → Server validates → marks online → requests session list
  → Agent sends sessions-sync

Browser opens a session on an agent
  → connects /ws/terminal?agent=<id>&session=<name>
  → Server validates JWT + user owns agent + agent is online
  → Server generates browserId
  → Server sends terminal-attach to Agent
  → Agent spawns node-pty, attaches to tmux session
  → Terminal data relayed bidirectionally

Browser disconnects
  → Server sends terminal-detach to Agent
  → Agent kills the corresponding pty process

Agent disconnects
  → Server marks offline
  → Sends error to all browsers connected to this agent, closes their sockets
```

### Server In-Memory State

```typescript
// Online agent connections
Map<agentId, {
  socket: WebSocket
  userId: string
  name: string
  sessions: SessionSummary[]
}>

// Browser-to-agent routing
Map<browserId, {
  browserSocket: WebSocket
  agentId: string
}>
```

### Heartbeat

- Agent sends `{ type: 'heartbeat' }` every 30 seconds
- Server updates `last_seen_at` in DB
- Server marks agent offline if no heartbeat for 60 seconds

## Permission Model

- Each agent belongs to the user who registered it
- Users can only see and use their own agents
- Admin can see all agents (future, not MVP)

## Project Structure

```
webmux/
├── packages/
│   ├── server/          # @webmux/server
│   │   └── src/
│   │       ├── index.ts
│   │       ├── db.ts              # SQLite
│   │       ├── auth.ts            # GitHub OAuth + JWT
│   │       ├── router.ts          # REST API
│   │       ├── agent-hub.ts       # Agent connection pool
│   │       └── relay.ts           # Browser ↔ Agent relay
│   │
│   ├── agent/           # @webmux/agent
│   │   └── src/
│   │       ├── cli.ts             # CLI entry (register/start)
│   │       ├── connection.ts      # WebSocket to Server + reconnect
│   │       ├── terminal.ts        # Existing createTerminalBridge
│   │       ├── tmux.ts            # Existing TmuxClient
│   │       └── credentials.ts     # ~/.webmux/ read/write
│   │
│   ├── web/             # @webmux/web
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── pages/
│   │       │   ├── LoginPage.tsx
│   │       │   ├── AgentsPage.tsx
│   │       │   └── SessionsPage.tsx
│   │       └── components/
│   │
│   └── shared/          # @webmux/shared
│       └── contracts.ts
│
├── pnpm-workspace.yaml
└── package.json
```

## Frontend Changes

- Add login page (GitHub OAuth button, or auto-login in dev mode)
- Add agent list page (select which machine to connect)
- Sessions page stays mostly the same, scoped to selected agent
- URL structure: `/agents` → `/agents/:agentId/sessions`

## Agent CLI

```bash
# Install
npm install -g @webmux/agent

# Register (one-time)
webmux-agent register \
  --server https://webmux.example.com \
  --token <registration-token> \
  --name my-nas

# Start (run as daemon or via systemd)
webmux-agent start

# Status
webmux-agent status
```

## Environment Variables

### Server (production)
- `GITHUB_CLIENT_ID` — GitHub OAuth App Client ID
- `GITHUB_CLIENT_SECRET` — GitHub OAuth App Client Secret
- `JWT_SECRET` — JWT signing secret
- `WEBMUX_BASE_URL` — Public URL for OAuth callback
- `DATABASE_PATH` — SQLite file path (default: `./webmux.db`)
- `PORT` — HTTP port (default: `4317`)

### Server (development)
- `WEBMUX_DEV_MODE=true` — Skip GitHub OAuth, auto-login as dev admin
- `JWT_SECRET=dev-secret`

### Agent
- Credentials stored in `~/.webmux/credentials.json` after registration

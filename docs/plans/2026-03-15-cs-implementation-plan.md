# C/S Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor webmux from single-machine to client-server architecture with Server (public relay + auth), Agent (machine-side tmux), and Web (React frontend).

**Architecture:** Server is a stateless relay with SQLite for user/agent metadata. Agent connects to Server via WebSocket, manages tmux locally. Browser talks to Server only. GitHub OAuth for user auth, registration-token flow for agent auth.

**Tech Stack:** pnpm workspaces, Fastify, better-sqlite3, jsonwebtoken, bcrypt, ws, node-pty, React Router, commander

---

### Task 1: Monorepo Setup

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`
- Modify: root `package.json` (remove deps, add workspace scripts)
- Modify: root `tsconfig.json`

**Steps:**
1. Create `pnpm-workspace.yaml` with `packages/*`
2. Create each package with its own `package.json` and `tsconfig.json`
3. Move existing `shared/contracts.ts` → `packages/shared/src/contracts.ts`
4. Move existing `server/*` → `packages/agent/src/` (tmux.ts, terminal.ts will live in agent)
5. Move existing `src/*` → `packages/web/src/`
6. Move `vite.config.ts`, `eslint.config.js`, `index.html` → `packages/web/`
7. Update root `package.json` with workspace-level scripts
8. `pnpm install` and verify structure
9. Commit

### Task 2: Shared Contracts

**Files:**
- Create: `packages/shared/src/contracts.ts` (full rewrite with new types)

**Steps:**
1. Define all types: SessionSummary, AgentMessage, ServerToAgentMessage, TerminalClientMessage, TerminalServerMessage, SessionEvent, API request/response types, AgentInfo
2. Export everything
3. Verify typecheck
4. Commit

### Task 3: Server — Database Layer

**Files:**
- Create: `packages/server/src/db.ts`
- Create: `packages/server/src/db.test.ts`

**Steps:**
1. Install `better-sqlite3` and `@types/better-sqlite3`
2. Write db.ts with: initDb(), createUser(), findUserByGithubId(), createAgent(), findAgentsByUserId(), findAgentById(), createRegistrationToken(), consumeRegistrationToken(), updateAgentStatus(), updateAgentLastSeen()
3. Write tests for each DB function
4. Run tests
5. Commit

### Task 4: Server — Auth (JWT + GitHub OAuth + Dev Mode)

**Files:**
- Create: `packages/server/src/auth.ts`
- Create: `packages/server/src/auth.test.ts`

**Steps:**
1. Install `jsonwebtoken`, `@types/jsonwebtoken`, `bcrypt`, `@types/bcrypt`
2. Write auth.ts: signJwt(), verifyJwt(), hashSecret(), verifySecret(), githubOAuthUrl(), exchangeGithubCode(), getGithubUser()
3. Write tests for JWT sign/verify and secret hash/verify
4. Commit

### Task 5: Server — REST API Routes

**Files:**
- Create: `packages/server/src/router.ts`

**Steps:**
1. Auth routes: GET `/api/auth/github` (redirect), GET `/api/auth/github/callback`, GET `/api/auth/dev` (dev mode only), GET `/api/auth/me`
2. Agent routes: GET `/api/agents` (list user's agents), POST `/api/agents/register-token` (generate token), POST `/api/agents/register` (agent calls this with token), DELETE `/api/agents/:id`
3. Session routes: GET `/api/agents/:id/sessions` (proxy to agent), POST `/api/agents/:id/sessions` (create), DELETE `/api/agents/:id/sessions/:name` (kill)
4. JWT auth middleware (fastify hook)
5. Commit

### Task 6: Server — Agent Hub

**Files:**
- Create: `packages/server/src/agent-hub.ts`

**Steps:**
1. AgentHub class: manages Map of connected agents
2. handleAgentConnection(): auth, register in map, request sessions-list
3. handleAgentMessage(): route sessions-sync, terminal-output, terminal-ready, terminal-exit, error
4. handleAgentDisconnect(): mark offline, close related browser connections
5. Heartbeat monitoring: 30s check, mark offline after 60s no heartbeat
6. Methods: getAgent(), getAgentSessions(), isOnline(), sendToAgent()
7. Commit

### Task 7: Server — Relay (Browser ↔ Agent)

**Files:**
- Create: `packages/server/src/relay.ts`

**Steps:**
1. handleTerminalConnection(): validate JWT, validate agent ownership, check agent online, generate browserId, send terminal-attach to agent, set up bidirectional relay
2. handleBrowserMessage(): parse input/resize, forward to agent with browserId
3. handleBrowserDisconnect(): send terminal-detach to agent, clean up map
4. Forward agent terminal-output/terminal-ready/terminal-exit to corresponding browser
5. Commit

### Task 8: Server — Main Entry + Events WebSocket

**Files:**
- Create: `packages/server/src/index.ts`

**Steps:**
1. Wire up: Fastify server, DB init, router, WebSocket servers (agent, terminal, events)
2. Handle upgrade for /ws/agent, /ws/terminal, /ws/events
3. Events WS: when agent reports sessions-sync, forward to browsers watching that agent
4. Static file serving for production build
5. Dev mode detection and logging
6. Commit

### Task 9: Agent — Credentials + Tmux + Terminal

**Files:**
- Create: `packages/agent/src/credentials.ts`
- Move: `packages/agent/src/tmux.ts` (from existing)
- Move: `packages/agent/src/terminal.ts` (from existing, modify for multi-browser)
- Create: `packages/agent/src/tmux.test.ts` (from existing)

**Steps:**
1. credentials.ts: loadCredentials(), saveCredentials(), credentialsPath() — read/write ~/.webmux/credentials.json
2. Move tmux.ts as-is (it's agent-side now)
3. Modify terminal.ts: createTerminalBridge now takes browserId, manages multiple bridges per agent
4. Move and update tests
5. Commit

### Task 10: Agent — WebSocket Connection

**Files:**
- Create: `packages/agent/src/connection.ts`

**Steps:**
1. AgentConnection class: connect to server /ws/agent, send auth message
2. Handle ServerToAgentMessage: sessions-list → report sessions, terminal-attach → create bridge, terminal-detach → dispose bridge, terminal-input → write to bridge, terminal-resize → resize bridge, session-create → tmux create, session-kill → tmux kill
3. Heartbeat: send every 30s
4. Auto-reconnect with exponential backoff
5. Manage Map<browserId, TerminalBridge>
6. Commit

### Task 11: Agent — CLI Entry

**Files:**
- Create: `packages/agent/src/cli.ts`

**Steps:**
1. Install `commander`
2. `register` command: --server, --token, --name → call POST /api/agents/register → save credentials
3. `start` command: load credentials → create TmuxClient → create AgentConnection → connect
4. `status` command: load credentials → show server URL, agent name
5. Add bin entry to package.json
6. Commit

### Task 12: Web — Auth Context + Login Page

**Files:**
- Create: `packages/web/src/auth.ts` (context + hooks)
- Create: `packages/web/src/pages/LoginPage.tsx`

**Steps:**
1. Install `react-router-dom`
2. AuthProvider: store JWT in localStorage, provide user info, login/logout functions
3. useAuth() hook
4. LoginPage: GitHub OAuth button (or auto-login in dev mode)
5. Handle OAuth callback: read JWT from URL, store, redirect to /
6. Commit

### Task 13: Web — Agent List Page

**Files:**
- Create: `packages/web/src/pages/AgentsPage.tsx`

**Steps:**
1. Fetch GET /api/agents → list user's agents with online/offline status
2. "Add Agent" button → POST /api/agents/register-token → show registration command modal
3. Click agent → navigate to /agents/:id
4. Delete agent button
5. Commit

### Task 14: Web — Sessions Page (Refactor)

**Files:**
- Modify: `packages/web/src/pages/SessionsPage.tsx` (refactor from existing App.tsx)

**Steps:**
1. Read agentId from URL params
2. Fetch sessions from /api/agents/:id/sessions (or via events WS)
3. Connect terminal WS with ?agent=<id>&session=<name>
4. Reuse existing SessionSidebar, TerminalPanel, CommandPalette
5. Commit

### Task 15: Web — App Shell + Routing

**Files:**
- Modify: `packages/web/src/App.tsx` (full rewrite)

**Steps:**
1. Set up React Router: / → AgentsPage, /agents/:id → SessionsPage, /login → LoginPage
2. Auth guard: redirect to /login if no JWT
3. Top nav bar with user avatar, logout
4. Commit

### Task 16: Integration + Dev Scripts

**Steps:**
1. Root package.json dev script: run server + web + agent concurrently
2. Vite proxy config for /api and /ws to server
3. Test full flow: dev mode login → create agent token → register agent → agent connects → create session → terminal works
4. Fix any issues found
5. Build all packages
6. Commit

### Task 17: Cleanup

**Steps:**
1. Remove old top-level server/ and src/ directories
2. Remove old shared/ directory
3. Update .gitignore
4. Final typecheck + lint + test
5. Commit

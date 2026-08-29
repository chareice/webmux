# Agent Sessions Backend (ACP) — Implementation Spec

Date: 2026-08-29. Branch: `feat-agent-sessions-backend`. Scope: **Rust only** (crates/protocol, crates/machine, crates/hub). No frontend changes in this PR (a parallel branch is refactoring `packages/app`; do not touch it).

## Product context

webmux is adding a second session type next to terminals: **agent sessions** — a coding agent (claude / codex / grok / kimi) hosted by the machine agent and driven over **ACP (Agent Client Protocol, JSON-RPC over stdio, ndjson framing, protocolVersion 1)**. The browser will render these as a chat view (separate PR). This PR builds the entire backend chain: spawn agent process → ACP client → normalized event stream → hub persistence + relay → REST/WS for the browser.

Verified facts (do not re-litigate):
- `kimi acp` and `grok agent stdio` are native ACP servers (initialize handshake tested on this machine; both advertise `loadSession`).
- claude/codex use adapters: `npx @zed-industries/claude-code-acp` and `npx @zed-industries/codex-acp`.
- Default mode is **auto-run (yolo)**: permission requests are auto-approved. There is NO approval UI. Agents may still ask questions (ACP `session/request_permission` when auto_run=false, and normal agent questions); those surface as `Question` events.
- Machines can carry a `production` flag; agent sessions on production machines default to `auto_run=false`.

## Existing architecture (read these first)

- `crates/protocol/src/lib.rs` — single file, all shared types: `HubToMachine`, `MachineToHub`, `BrowserEvent` (+ envelope with `seq`), `BrowserStateSnapshot` (bootstrap). Everything is serde-tolerant/additive: old peers ignore unknown variants — follow the existing `#[serde(tag = "type", rename_all = "snake_case")]` conventions exactly.
- `crates/machine/src/` — `hub_conn.rs` (WS to hub, message dispatch), `pty.rs` (tmux terminal spawn — note the systemd-run scope wrapping from PR #281), `config.rs` (machine.json), `session_watcher.rs` (5s tmux polling).
- `crates/hub/src/` — `ws.rs` (machine WS + browser events WS, envelope seq, replay), `db/` (one module per table, rusqlite, migrations in `db/mod.rs` or `hub_state.rs` — follow existing migration pattern), `routes/` (axum routers; note control-lease gating on mutating terminal routes in `routes/terminals.rs`, mirror it).
- Local dev loop (no docker): `WEBMUX_DEV_MODE=true webmux-server --listen 127.0.0.1:4399 --database /tmp/x/hub.db`; JWT via `GET /api/auth/dev`; register node with `XDG_CONFIG_HOME` isolated so the real `~/.config/webmux` is untouched; claim control lease via `POST /api/mode/control` before mutating routes.

## 1. Protocol additions (crates/protocol)

All additive. New types:

```rust
pub enum AgentKind { Claude, Codex, Grok, Kimi }          // snake_case on the wire

pub enum AgentSessionStatus { Starting, Working, Asked, Idle, Error, Disconnected }
// "done/unread" is NOT a status — the browser derives it from last_seen_seq < last_event_seq while Idle.

pub struct AgentSessionInfo {
  id: String, machine_id: String, agent_kind: AgentKind, cwd: String,
  title: String,                       // agent/user visible title; default: last path segment of cwd
  status: AgentSessionStatus,
  auto_run: bool,
  acp_session_id: Option<String>,      // set once session/new returns; needed for resume
  workspace_group_id: Option<String>,
  last_event_seq: u64,
  created_at_ms: i64,
}

pub struct AgentQuestionOption { id: String, label: String, detail: Option<String> }

pub enum AgentEvent {                 // normalized ACP updates, tagged snake_case
  UserMessage { text: String },       // echo of prompts, so the event log is the full transcript
  AgentMessageChunk { text: String },
  ThoughtChunk { text: String },
  ToolCall { tool_call_id: String, title: String, kind: Option<String>, status: String },
  ToolCallUpdate { tool_call_id: String, status: Option<String>, content: Option<String> },
  Plan { entries_json: String },      // raw JSON of ACP plan entries; browser renders later
  Question { request_id: String, prompt: String, options: Vec<AgentQuestionOption> },
  QuestionResolved { request_id: String },
  TurnEnded { stop_reason: String },
  Error { message: String },
}
```

`HubToMachine` new variants: `AgentSessionStart { session_id, agent_kind, cwd, auto_run, resume_acp_session_id: Option<String> }`, `AgentSessionPrompt { session_id, text }`, `AgentSessionAnswer { session_id, request_id, option_id: Option<String>, text: Option<String> }`, `AgentSessionCancel { session_id }` (cancel current turn), `AgentSessionKill { session_id }` (terminate process).

`MachineToHub` new variants: `AgentSessionUpdate { session_id, status: Option<AgentSessionStatus>, title: Option<String>, acp_session_id: Option<String> }`, `AgentSessionEvent { session_id, seq: u64, event: AgentEvent }` (seq: per-session monotonic, machine-assigned), `AgentSessionExited { session_id, reason: String }`.

`BrowserEvent` new variants: `AgentSessionCreated { session: AgentSessionInfo }`, `AgentSessionUpdated { session: AgentSessionInfo }`, `AgentSessionDestroyed { session_id }`, `AgentSessionEvent { session_id, seq, event: AgentEvent }`, `AgentSessionSeen { session_id, last_seen_seq }` (cross-device read sync).

`BrowserStateSnapshot`: add `agent_sessions: Vec<AgentSessionInfo>` and `agent_session_seen: HashMap<String, u64>` (session_id → last_seen_seq for the requesting user). Add `production: bool` to `MachineInfo` (default false via serde).

## 2. Machine: ACP client (crates/machine/src/acp.rs, new module)

Per session, spawn one child process with `current_dir = cwd`, stdio piped, **ndjson JSON-RPC** both ways. Command per kind (defaults, each overridable in machine.json config `acp_agents: HashMap<String, Vec<String>>` keyed by kind — the override is essential for tests):

- kimi: `kimi acp`
- grok: `grok agent stdio`
- claude: `npx --yes @zed-industries/claude-code-acp`
- codex: `npx --yes @zed-industries/codex-acp`

Lifecycle:
1. `initialize` → `{protocolVersion: 1, clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}}}`. 
2. New session: `session/new` with `{cwd, mcpServers: []}` → capture `sessionId`, report via `AgentSessionUpdate{acp_session_id}`. Resume: if `resume_acp_session_id` given, try `session/load` `{sessionId, cwd, mcpServers: []}` first; on error fall back to `session/new` and emit an `Error` event noting history was not restored. During `session/load` the agent replays history as `session/update` notifications — **suppress re-emitting replayed events to the hub** (the hub already has them); only track state.
3. Prompt: `session/prompt` `{sessionId, prompt: [{type: "text", text}]}`. Status → Working on send; on the JSON-RPC response (`stopReason`) emit `TurnEnded` and status → Idle (or Asked if a question is pending). Also emit `UserMessage` event before sending.
4. Notifications `session/update`: map `update.sessionUpdate` values → `AgentEvent`: `agent_message_chunk`→AgentMessageChunk (extract `content.text`), `agent_thought_chunk`→ThoughtChunk, `tool_call`→ToolCall, `tool_call_update`→ToolCallUpdate (serialize interesting content to string, cap 8KB), `plan`→Plan. Unknown update kinds: ignore silently (forward-compat).
5. Server request `session/request_permission`: if `auto_run` → immediately respond selecting the first option whose `kind` starts with `allow` (prefer `allow_once`), no event emitted. Else → emit `Question` (request_id = JSON-RPC id as string; options from the ACP options), status → Asked, park the JSON-RPC id; when `AgentSessionAnswer` arrives, respond `{outcome: {outcome: "selected", optionId}}` (or `cancelled` if session killed), emit `QuestionResolved`, status → Working.
6. `AgentSessionCancel` → notification `session/cancel` `{sessionId}`.
7. Child exit / stdio EOF → `AgentSessionExited{reason}`; hub marks Disconnected.
8. On machine process shutdown, kill children (they are not tmux; they die with us — that is accepted v1; resume covers recovery).

Wire into `hub_conn.rs` dispatch alongside existing terminal messages. Keep an in-memory registry `HashMap<session_id, AcpSessionHandle>` with per-session monotonic `seq` counters (start at 1; on resume, hub passes nothing — machine restarts seq, hub ignores seq ≤ stored last_event_seq).

Robustness: any malformed line from the child → log + ignore. JSON-RPC responses that error → `Error` event, don't crash. Timeouts: 30s for initialize/session_new → fail session with Error.

## 3. Hub (crates/hub)

DB (follow existing migration style):
- `agent_sessions` (id TEXT PK, user_id, machine_id, agent_kind, cwd, title, status, auto_run INT, acp_session_id, workspace_group_id NULL, last_event_seq INT, created_at, updated_at).
- `agent_session_events` (session_id, seq INT, event_json TEXT, created_at; PK (session_id, seq)). On insert, trim to the newest 5000 rows per session.
- `agent_session_seen` (user_id, session_id, last_seen_seq; PK (user_id, session_id)).
- `machines`: add column `production INTEGER NOT NULL DEFAULT 0`.

Routes (new `routes/agent_sessions.rs`, mount under existing auth; all mutating routes gated on the machine control lease exactly like `routes/terminals.rs`):
- `POST /api/machines/:machine_id/agent-sessions` `{agent_kind, cwd, auto_run?, workspace_group_id?}` → creates row (id = new uuid-ish like terminals), default `auto_run = !machine.production` when omitted, sends `AgentSessionStart`, returns `AgentSessionInfo`, broadcasts `AgentSessionCreated`.
- `POST .../agent-sessions/:id/prompt` `{text}` → forward `AgentSessionPrompt`.
- `POST .../agent-sessions/:id/answer` `{request_id, option_id?, text?}` → forward.
- `POST .../agent-sessions/:id/cancel` → forward `AgentSessionCancel`.
- `POST .../agent-sessions/:id/resume` → re-send `AgentSessionStart` with stored `resume_acp_session_id = acp_session_id` (only when status is Disconnected/Error).
- `DELETE .../agent-sessions/:id` → `AgentSessionKill`, delete rows (events + seen too), broadcast `AgentSessionDestroyed`.
- `GET .../agent-sessions/:id/events?from_seq=&limit=` → ordered event page `{events: [{seq, event}], last_seq}` (default limit 500, max 2000) — the browser's backfill path.
- `PUT /api/agent-sessions/:id/seen` `{last_seen_seq}` → upsert (monotonic: never decrease), broadcast `AgentSessionSeen` to the user's other devices.
- `PATCH /api/machines/:machine_id` `{production: bool}` → update flag, broadcast machine update (reuse existing machine-updated event if present, else include in next bootstrap).

Machine WS handling (`ws.rs` / `machine_manager.rs`): on `AgentSessionEvent` → persist (ignore seq ≤ last_event_seq), bump `last_event_seq`, broadcast browser `AgentSessionEvent`; on `AgentSessionUpdate` → persist + broadcast `AgentSessionUpdated`; on `AgentSessionExited` → status Disconnected + broadcast. On machine disconnect: mark all its Working/Asked/Idle/Starting agent sessions Disconnected + broadcast.

Bootstrap (`routes/bootstrap.rs`): include user's agent_sessions + seen map.

## 4. Tests (must pass; this is the acceptance bar)

- **Fake ACP agent**: add `e2e/fake-acp-agent.py` (python3, stdlib only, executable): ndjson JSON-RPC server on stdio implementing initialize, session/new, session/load, session/prompt (responds after emitting: one agent_thought_chunk, one agent_message_chunk "echo: <prompt>", one tool_call + tool_call_update, then — if env `FAKE_ACP_ASK=1` — a `session/request_permission` request it waits on before finishing), session/cancel. Deterministic, no network.
- **Machine unit/integration tests** (`crates/machine`): spawn the acp module against the fake agent (config override) and assert: normalized event sequence; auto_run=true auto-approves permission (no Question event); auto_run=false yields Question then Answer resolves it; child exit yields Exited.
- **Hub tests**: route-level tests following existing patterns in the hub crate (create → events persisted → GET events pages correctly; seen is monotonic; production default flips auto_run).
- **Full-stack smoke** (document exact commands at the bottom of this file after verifying them yourself): dev-mode hub + registered node (XDG-isolated) with `acp_agents` overridden to the fake agent → curl: claim control → create session → prompt → poll GET events until TurnEnded appears → assert echo chunk present. Write this as a small script `e2e/agent-sessions-smoke.sh` (no docker, no sudo).
- `cargo test --workspace` and `cargo clippy --workspace` must be clean. Do not break any existing test.

## Constraints

- Additive protocol only; a v0.14 node against a new hub (and vice versa) must not crash — serde ignores unknowns; verify no `deny_unknown_fields` is introduced.
- Never spawn agents through the shell (`sh -c`) — argv vectors only.
- Don't touch `packages/*`, `e2e/*.spec.ts` (Playwright), or Dockerfiles except adding the fake agent + smoke script.
- Commit in logical chunks on this branch with clear messages. When done, write a summary of what was built, test results (paste real output), and any deviations from this spec into `docs/plans/2026-08-29-agent-sessions-backend-REPORT.md`.

## Verified smoke commands (added during implementation)

`e2e/agent-sessions-smoke.sh` (no docker, no sudo; requires tmux + python3) runs the whole
chain: builds `webmux-server`/`webmux-node`, starts a dev-mode hub, registers an XDG-isolated
node with `acp_agents` overridden to `e2e/fake-acp-agent.py`, then curls: claim control →
create session → prompt → poll `GET .../events` until `turn_ended` → asserts the
`echo: hello smoke` chunk. Verified output: `6 events, last_seq=6` / `SMOKE OK`.

    ./e2e/agent-sessions-smoke.sh

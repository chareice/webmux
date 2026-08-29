# Agent Sessions Backend (ACP) — Implementation Report

Date: 2026-08-29. Branch: `feat-agent-sessions-backend`.
Spec: `docs/plans/2026-08-29-agent-sessions-backend.md` (implemented in full).

## What was built

### Protocol (`crates/protocol/src/lib.rs`)
- `AgentKind` (claude/codex/grok/kimi), `AgentSessionStatus`
  (starting/working/asked/idle/error/disconnected), `AgentSessionInfo`,
  `AgentQuestionOption`, and the tagged snake_case `AgentEvent` enum
  (user_message, agent_message_chunk, thought_chunk, tool_call,
  tool_call_update, plan, question, question_resolved, turn_ended, error).
- `HubToMachine`: `agent_session_start` (with `resume_acp_session_id`),
  `agent_session_prompt`, `agent_session_answer`, `agent_session_cancel`,
  `agent_session_kill`.
- `MachineToHub`: `agent_session_update`, `agent_session_event` (per-session
  machine-assigned seq), `agent_session_exited`.
- `BrowserEvent`: `agent_session_created/updated/destroyed/event/seen`.
- `BrowserStateSnapshot`: `agent_sessions` + `agent_session_seen`
  (`#[serde(default)]`). `MachineInfo.production` (`#[serde(default)] false`).
- All additive; no `deny_unknown_fields` anywhere. Old peers drop unknown
  variants at the message level, matching the existing convention (see the
  `RefreshAttach` comment).

### Machine ACP client (`crates/machine/src/acp.rs`, new)
- One child process per session, spawned as an argv vector (never `sh -c`)
  with `current_dir = cwd`, ndjson JSON-RPC both ways, `kill_on_drop`.
- Commands per kind with `acp_agents: HashMap<String, Vec<String>>` overrides
  in machine.json (defaults: `kimi acp`, `grok agent stdio`,
  `npx --yes @zed-industries/claude-code-acp`, `npx --yes @zed-industries/codex-acp`).
- Lifecycle: `initialize` (protocolVersion 1, fs caps false) → `session/new`
  (or `session/load` on resume with replay suppression, falling back to
  `session/new` + an `Error` event when the agent has lost the history) →
  `session/prompt` with `UserMessage` echo, `TurnEnded` on the response.
- `session/update` notifications map to `AgentEvent`s (chunks, tool calls
  with 8KB-capped content, plans); unknown kinds ignored. Malformed lines are
  logged and skipped.
- `session/request_permission`: auto_run → auto-selects the first `allow*`
  option (preferring `allow_once`), no event. Otherwise → `Question` event
  (request_id = wire JSON-RPC id), status Asked, parked until
  `AgentSessionAnswer` resolves it (`selected`/`cancelled`) →
  `QuestionResolved`, status Working. Unknown server requests get a
  JSON-RPC method-not-found error so agents never hang.
- 30s watchdogs on initialize/session-new/session-load fail the session with
  an `Error` event. Child exit/EOF → `AgentSessionExited`. Sessions live in a
  per-hub-connection registry and are killed when the connection drops or the
  machine exits (accepted v1 semantics; resume covers recovery).

### Hub (`crates/hub`)
- DB: `agent_sessions`, `agent_session_events` (PK (session_id, seq), trimmed
  to newest 5000 on insert), `agent_session_seen` (PK (user_id, session_id),
  monotonic upsert), plus `machines.production INTEGER NOT NULL DEFAULT 0`
  (column migration following the existing pattern).
- Machine WS handling: `AgentSessionEvent` persists (ignoring
  seq ≤ last_event_seq) + bumps the watermark + broadcasts;
  `AgentSessionUpdate`/`AgentSessionExited` persist + broadcast
  `AgentSessionUpdated` (Exited → Disconnected). Machine disconnect marks all
  starting/working/asked/idle sessions Disconnected + broadcasts each.
- Routes (`crates/hub/src/routes/agent_sessions.rs`, all behind auth, machine
  mutations gated on the control lease like `routes/terminals.rs`):
  `POST /api/machines/:id/agent-sessions` (auto_run defaults to
  `!machine.production`, title defaults to the cwd basename, broadcasts
  `AgentSessionCreated`), `.../:sid/prompt`, `.../answer`, `.../cancel`,
  `.../resume` (only when Disconnected/Error; re-sends start with the stored
  acp_session_id), `DELETE .../:sid` (best-effort kill, deletes session +
  events + seen rows), `GET .../:sid/events?from_seq=&limit=` (default 500,
  max 2000, returns `{events: [{seq, event}], last_seq}`),
  `PUT /api/agent-sessions/:sid/seen` (monotonic, broadcasts
  `AgentSessionSeen`), `PATCH /api/machines/:id` (`{production: bool}`).
- Bootstrap snapshot includes the user's agent sessions and seen map.

### Fake ACP agent (`e2e/fake-acp-agent.py`)
python3 stdlib-only executable ndjson JSON-RPC server: initialize,
session/new, session/load (replays stored prompt history), session/prompt
(deterministic thought chunk → `echo: <text>` chunk → tool_call +
tool_call_update, optional `session/request_permission` wait under
`FAKE_ACP_ASK=1`, then `stopReason`), session/cancel, and a `die` prompt that
hard-exits to simulate a crash.

## Test results (real output)

```
$ cargo test --workspace
running 49 tests   test result: ok. 49 passed; 0 failed    (tc-cli)
running 98 tests   test result: ok. 98 passed; 0 failed    (tc-hub)
running 38 tests   test result: ok. 38 passed; 0 failed    (tc-machine)
running 14 tests   test result: ok. 14 passed; 0 failed    (tc-protocol)
```

New coverage: 5 protocol round-trip/default tests; 8 hub DB tests (paging,
trim-at-5000, seen monotonicity, disconnect marking, delete cascades); 8 hub
route tests (create+start command+broadcast, production→auto_run=false
default, event persistence/paging/stale-seq drop, seen→bootstrap, resume
gating + acp_session_id pass-through, disconnect marking, control-lease 403 /
404, delete cleanup); 6 machine ACP tests against the fake agent (normalized
event sequence with seq 1..=6, auto-run auto-approve without Question,
Question→Answer→QuestionResolved flow, crash → Exited, kill → Exited,
resume fallback to session/new).

```
$ cargo clippy --workspace --all-targets
    Finished `dev` profile [unoptimized + debuginfo] target(s)   # 0 warnings
```

Full-stack smoke (`./e2e/agent-sessions-smoke.sh`, no docker/sudo; dev-mode
hub + XDG-isolated registered node pointed at the fake agent; curl: control →
create → prompt → poll events):

```
==> polling events until turn_ended
    6 events, last_seq=6
SMOKE OK
```

## Deviations from the spec

- **`PUT /api/agent-sessions/:id/seen` is not control-lease gated.** It is a
  per-device read receipt, not a machine mutation; gating it on the machine's
  control lease would break read-sync from non-controlling devices. All
  machine-affecting routes (create/prompt/answer/cancel/resume/delete) and
  `PATCH /api/machines/:id` are gated exactly like `routes/terminals.rs`.
- **Cancel/resume/delete take `device_id` as a query param** (matching
  `destroy_terminal` in terminals.rs, which has no JSON body); create,
  prompt, answer, and PATCH take it in the JSON body.
- **Prompt/answer/cancel return 409** on Disconnected/Error sessions ("resume
  it first") instead of forwarding into the void — the machine would only log
  a warning for the unknown session.
- **Text-only answers** (no `option_id`) respond `cancelled` to the agent:
  ACP `session/request_permission` has no free-form answer channel.
- **`PATCH /api/machines/:id` emits no browser event** — no machine-updated
  variant exists, so the spec's fallback applies: the flag reaches browsers
  via the next bootstrap snapshot (connected machines' in-memory
  `MachineInfo` is updated immediately).
- **Machine tests skip gracefully** if `python3` or the fake agent is missing
  (CI environments without python3); on this machine all 6 run for real.

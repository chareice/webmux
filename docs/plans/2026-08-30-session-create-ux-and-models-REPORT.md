# Session creation UX overhaul + model selection — REPORT

Date: 2026-08-30. Branch: `feat-session-create-ux`. Spec: `2026-08-30-session-create-ux-and-models.md` (same directory).

## Agent probe results (live, this machine)

Probe method: spawn the agent's ACP stdio process in a scratch cwd (`/tmp/acp-probe/scratch`), drive ndjson JSON-RPC by hand: `initialize` → `session/new` → `session/set_model` (and `session/set_mode` where modes were advertised). Transcripts below are verbatim but trimmed to the model-relevant lines. **The raw grok transcript also dumps the user's locally configured MCP server list (including env credentials) in `_x.ai/mcp/servers_updated` notifications — those lines are deliberately not reproduced here.**

### kimi — `kimi acp` (Kimi Code CLI 0.39.1)

session/new carries **no `models` key**; it exposes `configOptions` (a `select` with `category: "model"`) plus a standard `modes` block:

```
>>> {"jsonrpc": "2.0", "id": 2, "method": "session/new", "params": {"cwd": "/tmp/acp-probe/scratch", "mcpServers": []}}
<<< {"jsonrpc":"2.0","id":2,"result":{"sessionId":"session_a3a164a3-…","configOptions":[
      {"type":"select","id":"model","name":"Model","category":"model","currentValue":"kimi-code/k3","options":[
        {"value":"kimi-code/kimi-for-coding","name":"K2.7 Coding"},
        {"value":"kimi-code/kimi-for-coding-highspeed","name":"K2.7 Coding Highspeed"},
        {"value":"kimi-code/k3","name":"K3"},
        {"value":"kimi-code/k3-256k","name":"K3-256k"}]},
      {"type":"select","id":"thinking","name":"Thinking","category":"thought_level","currentValue":"high","options":[…]},
      {"type":"select","id":"mode","name":"Mode","category":"mode","currentValue":"default","options":[…]}],
     "modes":{"currentModeId":"default","availableModes":[{"id":"default","name":"Default",…},{"id":"plan",…},{"id":"auto",…},{"id":"yolo",…}]}}}
```

`session/set_model` **works** with the configOptions model values (and rejects others); `session/set_config_option` also exists (unused by us):

```
>>> {"jsonrpc": "2.0", "id": 3, "method": "session/set_model", "params": {"sessionId": "session_a3a164a3-…", "modelId": "kimi-code/kimi-for-coding"}}
<<< {"jsonrpc":"2.0","id":3,"result":{}}

>>> {"jsonrpc": "2.0", "id": 3, "method": "session/set_model", "params": {"sessionId": "session_2f87050e-…", "modelId": "probe-bogus"}}
<<< {"jsonrpc":"2.0","id":3,"error":{"code":-32603,"message":"Internal error","data":{"details":"Model \"probe-bogus\" is not configured in config.toml."}}}

>>> {"jsonrpc": "2.0", "id": 4, "method": "session/set_mode", "params": {"sessionId": "session_2f87050e-…", "modeId": "default"}}
<<< {"jsonrpc":"2.0","id":4,"result":{}}   (plus current_mode_update / config_option_update notifications)
```

**Verdict: model selection supported** — normalized from `configOptions` (category `"model"`); modes advertised (default/plan/auto/yolo) and stashed, no mode UI built per spec.

### grok — `grok agent stdio` (grok 1.0.13)

session/new carries the **standard ACP `models` key** (2 models, current grok-4.6); no `modes` key (its "modes" are reasoning efforts under `_meta.x.ai/sessionConfig`):

```
>>> {"jsonrpc": "2.0", "id": 2, "method": "session/new", "params": {"cwd": "/tmp/acp-probe/scratch", "mcpServers": []}}
<<< {"jsonrpc":"2.0","id":2,"result":{"sessionId":"01a04fd5-…","models":{
      "currentModelId":"grok-4.6",
      "availableModels":[
        {"modelId":"grok-4.6","name":"Grok 4.6","description":"SpaceXAI's latest frontier model", …},
        {"modelId":"grok-4.5","name":"Grok 4.5", …}]}, "_meta":{…}}}

>>> {"jsonrpc": "2.0", "id": 3, "method": "session/set_model", "params": {"sessionId": "01a04fd5-…", "modelId": "grok-4.5"}}
<<< {"jsonrpc":"2.0","id":3,"result":{"_meta":{"model":{"Ok":"grok-4.5"}}}}   (plus _x.ai/models/update broadcasts)

>>> {"jsonrpc": "2.0", "id": 4, "method": "session/set_model", "params": {"sessionId": "01a04fd5-…", "modelId": "probe-bogus"}}
<<< {"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"Invalid params","data":"unknown model id"}}
```

**Verdict: model selection supported** via the standard shape. `session/set_mode` returns `{}` but grok advertises no `modes`, so nothing is rendered.

(claude-code-acp / codex-acp were not re-probed; the spec's verified facts about their standard `models`/`modes` shape stand and are handled by the same code path as grok.)

## What was built

### Part 1 — model & mode plumbing (backend)

- **protocol** (`crates/protocol/src/lib.rs`): `AgentModelInfo {model_id, name, description}`; `AgentSessionInfo` += `available_models` (empty = unsupported) + `current_model_id`; `HubToMachine::AgentSessionSetModel {session_id, model_id}`; `AgentSessionStart` += optional `model_id` (create-time model); `AgentSessionUpdate` += optional `available_models`/`current_model_id` (None = unchanged). All additive/serde-tolerant.
- **machine** (`crates/machine/src/acp.rs`): `parse_session_models` normalizes both probed shapes — standard `models` key (claude/codex/grok) and kimi's `configOptions` select (category "model") — from session/new (state-redefining) and session/load (fills in only what it carries). Modes are parsed and stashed on the actor for a future mode UI. The ready `AgentSessionUpdate` carries the model list + current model. `SetModel` → `session/set_model`; success reports `current_model_id`; a JSON-RPC error becomes an `Error` event (never a session failure); agents that reported no model info reject SetModel locally with an `Error` event. A create-time model is applied via `session/set_model` immediately after ready, **before** queued prompts flush (flush deferred until the set_model response, success or error).
- **hub**: `agent_sessions` gains `available_models` (JSON), `current_model_id`, `requested_model_id` columns (idempotent ALTERs). `apply_update` persists the model fields; `row_to_info` surfaces them, so bootstrap snapshots and browser events include them automatically. `POST agent-sessions` accepts optional `model_id` (stored as requested, forwarded to the machine). New route `POST /api/machines/:m/agent-sessions/:id/model {model_id}`, lease-gated and live-checked like prompt, relaying `AgentSessionSetModel`.

### Part 2 — create flow redesign (desktop)

- **Remembered defaults** (`packages/app/lib/sessionDefaults.ts`, localStorage, storage-injected like viewOnlyLock): last-used `{agentKind, modelId, autoRun}`, per-machine last cwd, and a per-agent-kind cache of last-seen `available_models` (fed from live sessions in TerminalCanvas). First-ever use → kimi / agent-default model / machine-default auto-run.
- **Project-level ＋**: every sidebar section header's hover ＋ is now a two-item menu — "New agent chat" (instant create in that project's cwd with remembered agent+model, zero dialog) and "New terminal here" (existing behavior).
- **Global ＋ panel** (`NewSessionDialog`): the 3-step form is one compact panel — agent chips (remembered preselected), model dropdown per agent kind (from live sessions, else the persisted cache; empty → hidden with the "模型在会话内可切换" hint), directory (recent cwds from existing sessions/terminals first, then bookmarks, then free text; machine picker only when >1 machine online), single-line auto-run toggle with the PROD note only on production machines, footer with Create + not-controller hint (summary block removed). Everything prefilled → plain Enter creates. Terminal chip hides the model/auto-run rows. Submit persists the new defaults + last cwd.
- **Starting-state honesty** (`AgentChatView`): while `starting`, the status pill reads "正在启动 \<agent\>… Ns" (elapsed seconds ticking), npx-wrapped agents (claude/codex) get a "冷启动约 1 分钟" hint, and the composer stays enabled with its existing starting note.
- **Chat-header model picker**: current model as a small dropdown next to the auto-run chip (switches via the new /model route; disabled while a turn is `working`); empty `available_models` → static label if `current_model_id` exists, else nothing.
- Mobile (`MobileWorkbench`) untouched; `NewSessionDialog`'s exports (`NewSessionRequest`, props) kept coherent, extended with `modelId`.

## Checks (real output, this machine, this branch)

- `cargo test --workspace` — **213 passed, 0 failed**: cli 49, hub 102, machine 47, protocol 15. New coverage: `parse_session_models_handles_both_wire_shapes`, `ready_update_carries_the_advertised_models`, `create_time_model_is_applied_before_queued_prompts`, `set_model_switches_and_reports_the_current_model`, `set_model_error_is_an_event_not_a_session_failure`, `set_model_is_rejected_locally_when_the_agent_reported_no_models` (machine); `model_state_round_trips_and_updates_partially` (hub db); `create_with_model_forwards_it_and_stores_it_as_requested`, `model_route_is_lease_gated_and_relays_set_model`, `machine_model_updates_persist_and_reach_the_bootstrap_snapshot` (hub routes); protocol round-trips for the new wire shapes.
- `cargo clippy --workspace --all-targets -- -D warnings` — clean (one `doc_lazy_continuation` fixed during the run).
- `pnpm typecheck` (`tsc -b`) — clean.
- `pnpm test` (vitest) — **41 files, 335 tests passed**, incl. 8 new `sessionDefaults.test.ts` tests.
- `pnpm build` — exported `dist` successfully.
- The containerized e2e suite (`pnpm e2e:test`) was **not run** (spec: the human runs it) — specs were updated by reading; see risks below.

## Deviations from the spec

1. **`AgentSessionUpdate` model fields are `Option` (`None` = unchanged), not a plain `Vec`.** The spec literally said `available_models: Vec<AgentModelInfo>` on the update message, but that message's documented contract is "fields left `None` are unchanged" — a plain Vec would force every status-only update to either carry or clear the model list. `Some([])` still means "the agent explicitly reported no model support", so "empty = unsupported" survives.
2. **`requested_model_id` is hub-internal only** (DB column), not exposed on `AgentSessionInfo` — browsers never need it, and **resume does not re-apply it** (`model_id: None` on the resume start command); a resumed session keeps whatever model the agent restores. Re-applying on resume is a possible follow-up.
3. **kimi set_model** accepts the `configOptions` model values directly (verified above), so no separate `session/set_config_option` path was needed; the kimi-specific `config_option_update` notifications are not tracked — after our own `set_model` the confirmed `current_model_id` comes from the RPC response per spec.
4. **Plain Enter submits the panel** except when focus is on a chip button or the model select (those keep their native Enter behavior).
5. The fake ACP agent gained `FAKE_ACP_MODELS=0` (opt-out) so the "agent without model support" path is testable; it advertises models by default, which also makes the e2e node's chat headers show the model picker.

## E2E risk notes (updated by reading, NOT executed)

- `e2e/tests/agent-sessions.spec.ts` test 1: removed the `new-session-machine-e2e-node` click (machine picker now hidden with a single online machine) and added an assertion that it's absent; added model-picker assertions (`agent-chat-model-select` shows `fake-model-a`, `selectOption("fake-model-b")` round-trips through hub→machine→fake agent→broadcast). Risk: the header select's value depends on the hub round-trip after `selectOption`; `toHaveValue` auto-polls, so this should be robust.
- New test "the sidebar section ＋ creates an agent chat in one click": hover section → `sidebar-section-new-<groupId>` → menu item "New agent chat" → chat view opens with no dialog. Risks: (a) the ＋ button is opacity-0 until hover — Playwright's click after `section.hover()` should be fine, but if the container's mouseleave races, force-click may be needed; (b) localStorage starts empty per Playwright context, so the remembered agent is kimi → the instant create is deterministic.
- The remembered-defaults store makes the panel stateful across creates **within one test** (fresh per test — Playwright gives each test a clean context, so no cross-test bleed).
- `new-session-submit` / `-cwd-input` / `-agent-<kind>` / `-autorun` / `-not-controller` testids are unchanged; `new-session-summary` is gone (no e2e referenced it). The section ＋ `sidebar-section-new-<groupId>` now opens a menu instead of creating a terminal directly — no existing spec clicked it (verified by grep).
- Starting-state pill text changed ("starting…" → "正在启动 \<agent\>… Ns") — no spec asserts on the starting pill text.
- workspace-* specs only mention the dialog in prose comments (brand-row ＋ behavior unchanged); the four `.md` spec docs now say "new-session panel".

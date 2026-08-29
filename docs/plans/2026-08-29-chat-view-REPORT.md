# Desktop Chat View (agent sessions frontend) — Implementation Report

Date: 2026-08-29. Branch: `feat-chat-view`. Spec: `docs/plans/2026-08-29-chat-view.md`
(implemented in full; scope = `packages/app`, `packages/shared`, e2e infra; no `crates/*` edits).

## What was built

### Shared types (`packages/shared/src/contracts.ts`)
`AgentKind`, `AgentSessionStatus`, `AgentSessionInfo`, `AgentQuestionOption`,
`AgentEvent` (discriminated union, snake_case tags/fields mirroring
`crates/protocol/src/lib.rs` exactly), `MachineInfo.production?`, snapshot
fields `agent_sessions?` / `agent_session_seen?`, and the five
`BrowserEvent` variants (`agent_session_created/updated/destroyed/event/seen`).
All optional/additive so old hubs deserialize cleanly.

### Data layer (`packages/app/lib`)
- `api.ts`: `createAgentSession`, `promptAgentSession`, `answerAgentSession`,
  `cancelAgentSession`, `resumeAgentSession`, `destroyAgentSession`,
  `getAgentSessionEvents` (`AgentSessionEventsPage`), `putAgentSessionSeen`.
  device_id goes in the JSON body for create/prompt/answer and in the query
  string for cancel/resume/delete, matching the hub routes (and the
  `destroyTerminal` convention); `PUT seen` carries no device_id (not
  lease-gated).
- `bootstrapState.ts`: `BrowserSessionState` gains `agentSessions` +
  `agentSessionSeen`. Events: created/updated upsert, destroyed removes the
  session and its seen entry (via the existing `omitKey`, no computed-key
  rest-spread), `agent_session_event` only raises `last_event_seq` (raw events
  are NOT stored here — they go to the feed), `agent_session_seen` is
  monotonic. Tests extended (+7).
- `agentTranscript.ts` (new, pure): incremental transcript builder.
  Consecutive message/thought chunks aggregate into one block (closed by
  `turn_ended`, `user_message`, or any non-chunk event); tool_call rows mutate
  via tool_call_update (matched by id); question → ask-card resolved by
  question_resolved; error/plan rows; turn_end divider blocks; `seq <= lastSeq`
  dedup so backfill + live continuation overlap cleanly. 12 tests.
- `agentSessionFeed.ts` (new): module-level per-session store.
  `applyLiveAgentSessionEvent` (wired into the canvas events-WS handler),
  `ensureAgentSessionFeed` (backfill `GET events?from_seq=0&limit=500`, shared
  in-flight fetch, retry on failure), `removeAgentSessionFeed`,
  `getAgentSessionPendingQuestion` (live-tracked for the inbox, reconciled
  from the transcript after backfill), and `useAgentSessionFeed(session)` via
  `useSyncExternalStore` with cached immutable snapshots. **Race fix beyond
  the spec letter**: live events arriving before the backfill lands are
  buffered (capped at 1000), not applied — the transcript's `seq <= lastSeq`
  dedup would otherwise have dropped all pre-live history. 8 tests.

### Sidebar (`lib/sidebarTree.ts`, `components/Sidebar.web.tsx`, `components/AgentBadge.web.tsx`)
- `buildSidebarTree` gains agent rows (discriminated `SidebarRow` union;
  terminal variant unchanged). Placement: `workspace_group_id` → cwd match →
  synthetic cwd-labelled section (`cwd:<path>` key, `persistent: false`, same
  shape as terminal fallback sections; shared per cwd, appended after real
  groups). Agent rows after terminal rows; no status re-sorting. `unread =
  seen < last_event_seq && !selected`. `tree.askedSessions` = all `asked`
  sessions across ALL machines (host filter can't hide them), oldest first.
  5 new tests.
- Row rendering per Main/States designs: 2-letter badge (CL/CX/GR/KI per the
  design files, see deviations) + status dot — working = spinning info-blue
  arc (`webmuxSpin`, 1.6s), asked = amber diamond + amber left bar/row tint
  (the only amber), idle = hollow gray ring, error = solid red, disconnected
  = dashed ring + 50% row opacity, starting = blinking gray. Unread = bold
  title + small solid dot. Terminal rows untouched (reachability dot, never
  amber). testids: `sidebar-agent-row-<id>`, `…-unread`.
- Inbox banner (`sidebar-inbox`): slim amber banner between the hosts rail
  and the tree, only while ≥1 session is asked — "N waiting on you · oldest
  Xm". Click expands a dropdown (`sidebar-inbox-item-<id>`: badge, title,
  machine, age, question first line from the feed's pending-question map);
  clicking an item selects the session. No approve-in-place (the chat view's
  ask-card handles answers).
- The brand-row ＋ (unchanged testid `sidebar-new-tab`, still gated on
  active-machine controller) now opens the new-session dialog instead of
  creating a tab. Tab creation survives as the palette "New tab" action.
- `NewSessionDialog.web.tsx` per NewSession.dc.html: agent chips
  (claude/codex/grok/kimi/terminal), auto-run toggle (agents only; default
  `!machine.production`, reset on machine switch until manually touched),
  machine list (offline rows disabled, PROD tag + "auto-run off by default"
  note), directory step (free-text input + the machine's bookmarks fetched
  via `listBookmarks`), footer summary + Create (⌘/Ctrl+Enter; disabled
  unless controller of the chosen machine, with a "viewing — take control to
  create" hint). Terminal choice routes to the existing
  `handleCreateTerminal`; agent kinds call `createAgentSession` and select
  the new session. The design's "Open as split beside current" checkbox is
  omitted (split chat is out of scope — no dead UI).

### ChatView (`components/AgentChatView.web.tsx`)
Full-area layout per Main.dc.html, tokens from `lib/colors`. Header: badge +
title, agent-kind chip, `auto-run` / `auto-run off` (warn-styled) label,
`machine · cwd` line, status pill ("waiting on you" amber / working blue /
error red / gray otherwise), Resume (disconnected/error only), kill ✕ with
ConfirmDialog (danger). Stream: centered 820px column; user turns
(left-border block), assistant text (pre-wrap plain text, no markdown lib),
thought blocks collapsed by default ("Thinking" + first-line preview),
tool-call rows collapsible (title + status + spinner/check/red ✕; expanded
content in a scrollable `pre` on `termBg`), ask-cards (amber, A/B/C option
buttons, "or reply below" hint; resolved state dimmed), plan rows
(collapsible raw JSON — rendering is a later PR per the backend spec), error
rows, turn dividers. Autoscroll: sticks to bottom while at bottom, "↓ jump
to latest" chip otherwise. Composer: textarea (Enter sends, Shift+Enter
newline); while `working` the send button becomes Stop (cancel); while
`starting` input stays enabled with a "starting…" note (backend queues);
non-controllers get a disabled "viewing — Take control" bar (same
control-lease gating as terminal input); disconnected/error sessions show a
"resume it first" placeholder (the hub 409s prompts there). Read state:
while open + window focused, `putAgentSessionSeen(last_event_seq)` is sent
with a 1s debounce; inbound `agent_session_seen` events clear local unread
via bootstrapState → sidebarTree.

### Routing / selection (`components/TerminalCanvas.web.tsx`)
`selectedAgentSessionId` state, mutually exclusive with terminal zoom
(selecting either clears the other; creating a terminal clears it too). URL
hash `#/a/<id>` alongside `#/t/<id>`: parsed on load and popstate, written
on select, cleared on Esc / terminal selection / destroy. Restores
gracefully — a hash whose session is gone after bootstrap falls back to the
workspace and the hash is cleaned. The handoff-landing effect skips `#/a/`
hashes. `agent_session_event` envelopes are forwarded to the feed store;
`agent_session_destroyed` drops the feed and clears the selection. `putFocus`
stays terminals-only. Mobile (`MobileWorkbench`) untouched; `⌃B` shortcuts
and palette unchanged (palette "New tab" still creates a bare tab).

## Answer semantics decision (spec §4)

Verified against `crates/machine/src/acp.rs:552-565` and the fake agent: ACP
`session/request_permission` has no free-form channel — a text-only answer
responds `cancelled` (the machine logs exactly that) and the text is dropped.
So the frontend implements cancel-and-relay: free text sent while an
ask-card is unresolved first calls `answer(request_id, text)` (cancels the
permission request, card resolves, status → working), then re-sends the same
text as a normal `prompt`. Option buttons always send
`answer(request_id, option_id)`. Since only permission-style questions carry
options, option buttons + free-text-to-prompt covers both question shapes.

## Test output (real)

```
$ pnpm typecheck
> tsc -b          # clean, no output

$ pnpm test
Test Files  38 passed (38)
     Tests  314 passed (314)

$ pnpm build      # expo export --platform web
Exported: dist    # success

$ npx playwright test --list
Total: 73 tests in 22 files   # all specs parse (was 69 in 21)

$ cargo build     # untouched crates, still compiles
    Finished `dev` profile [unoptimized + debuginfo] target(s)
```

New vitest coverage: agentTranscript (12: aggregation, closure rules, tool
call/question lifecycle, incremental append, backfill overlap dedup, turn
dividers), agentSessionFeed (8: backfill seeding, buffered live events,
overlap dedup, failure retry, pending-question tracking/reconcile, removal,
reset), sidebarTree (+5: group-id/cwd/synthetic placement, row order, unread
matrix, askedSessions ordering/host-filter independence), bootstrapState
(+7: snapshot fields, upsert/destroy, last_event_seq bumps, monotonic seen),
api (+3: create body casing, cancel query param, events paging/seen).

## e2e notes for the human's docker run

- `e2e/Dockerfile.node`: apt line gains `python3`; the image now ships
  `e2e/fake-acp-agent.py` → `/opt/webmux/fake-acp-agent.py` and the new
  `e2e/machine.json` → `/root/.config/webmux/machine.json`, whose
  `acp_agents` map points every kind at the fake agent. **The file's
  `machine_id` must stay `e2e-node`** — once machine.json exists the CLI
  `--id` is ignored. `e2e/docker-compose.yml` sets `FAKE_ACP_ASK=1` on the
  node container (read once per agent process start; harmless for auto-run
  sessions, which auto-approve silently).
- New `e2e/tests/agent-sessions.spec.ts` (3 tests): dialog → kimi session →
  chat view → prompt → `echo: hello from e2e` → tool row completes → status
  back to idle + turn divider + sidebar row; ask-card flow via an
  `auto_run: false` session (created through the API — the env is
  process-wide, so per-session gating uses auto_run) → `Allow once` click →
  resolved + inbox empties + idle; kill via header ✕ + confirm removes the
  row. The ask-card flow IS wired end-to-end (not vitest-only).
- `helpers.ts`: `listAgentSessions` / `createAgentSessionViaApi` /
  `destroyAllAgentSessions`; `resetMachineState` now also deletes agent
  sessions (it holds the control lease while doing so — delete is gated).
- `workspace-tabs.spec.ts`: the two tests that clicked the brand-row ＋ to
  create a bare tab now use the command palette's "New tab" row
  (`pressPrefixKey "k"` → `command-palette-row-new-tab`) — the ＋ opens the
  new-session dialog now. `core-control-flow.spec.ts` keeps using
  `sidebar-new-tab` for gating assertions (the button's enabled/disabled
  semantics are unchanged). Prose specs updated to mention the dialog.
- Risks I could not verify locally (no docker here): (1) the dialog's
  machine row is disabled until the node's first stats tick lands
  (machineOnline rule) — Playwright's click retries should absorb this, but
  it's the most likely flake in test 1; (2) `webmuxSpin`/`webmuxBlink`
  keyframes are assumed present in the runner's CSS (they're in
  `packages/app/global.css`); (3) section headers containing only agent
  rows are synthetic cwd sections — clicking one runs `selectGroup` on an id
  the terminal workspace doesn't have (parks harmlessly, same as any
  not-yet-reconciled selection).

## Deviations from the spec

1. **Codex badge is `CX`, not `CO`.** The spec text says CL/CO/GR/KI, but
   both design files (Main + States + NewSession, marked authoritative) use
   `CX` consistently. Followed the design.
2. **Inbox "oldest Xm" uses `created_at_ms`.** `AgentSessionInfo` has no
   "asked at" timestamp; age is approximated from session creation. The
   pending-question prompt comes from the live-event-tracked map (populated
   for sessions asked before page load only after their transcript
   backfills — i.e., once opened; before that the dropdown row shows the
   title without the question line).
3. **Sidebar ＋ gating unchanged**: still keyed to the ACTIVE machine's
   controller state, not "controller of any machine" — matches the existing
   e2e gating contract (`core-control-flow.spec.ts`).
4. **Directory step uses bookmarks + free text only**; the design's live
   `↑↓` filesystem autocomplete was not wired (the `directoryAutocomplete`
   cache lib exists but has no ready-made picker UI).
5. **Synthetic agent-only section headers are selectable no-ops** (they
   select a group the terminal workspace doesn't have). Choosing a row
   inside them works normally.
6. **Esc in the composer exits the chat view** (the canvas-level binding is
   global; the textarea isn't `.xterm`). Draft text is lost only when the
   view unmounts — same as the rest of the app.

# Terminal Resume Protocol Design

Date: 2026-04-17

## Overview

Eliminate two visually distinct but architecturally identical bugs in the terminal view:

1. **Reconnect duplication** — When the browser's terminal WebSocket reconnects (network blip, tab becomes visible, laptop wakes, hub restart), the hub always re-sends the last 64KB of PTY output as an initial replay. The browser writes this replay into an xterm instance that is intentionally preserved across reconnects (to keep mouse-tracking and alt-screen modes). The replay overlaps already-rendered content and the user sees the same output twice.

2. **Tab-switch staleness** — When switching tabs, `SplitPaneContainer` re-renders a `<TerminalCard>` at the same position with a different `terminal` prop. Because the `<TerminalCard>` has no `key`, React reuses the component instance (and transitively the xterm instance inside `TerminalView.xterm.tsx`). The xterm effect that creates the terminal has `[]` deps and never re-runs, so the new tab's replay is written on top of the previous tab's xterm state.

Both symptoms share the same root cause: **the xterm instance carries server-side state across WS lifecycle events, but the server's replay protocol is stateless** — the hub always sends the full buffered output, never "what the client missed."

This spec introduces a byte-sequence-based resume protocol between the hub and the browser, plus a small UI key change, so that replays become well-defined and never overlap with what xterm already holds.

## Goals

- Zero duplicate content on WS reconnects for the same terminal, including cases where the client briefly misses bytes during the disconnect.
- Zero cross-tab content bleed when switching between terminals.
- No change to the machine ↔ hub binary PTY frame format (machine-side code untouched).
- Long-term architectural fix, not a client-side patch that papers over the symptom.

## Non-Goals

- Persisting terminal scrollback across hub restarts (hub restart still triggers a full replay from whatever tmux gives us — tmux is the source of truth for shell state).
- Preserving xterm local scroll state across tab switches (`scrollback: 0` is already configured in `TerminalView.xterm.tsx:286`; xterm holds no local history to preserve).
- Multi-client replay coordination beyond what already exists (`control_leases` handles "who can type").
- Changing the 64KB hub output buffer size.

## Root Cause Summary

Evidence trail supporting the shared root cause:

- `crates/hub/src/ws.rs:131-149` — hub unconditionally sends `output_buffer.clone()` as initial binary frame on every new WS subscribe.
- `crates/hub/src/machine_manager.rs:883-899` — `handle_terminal_output` extends a rolling 64KB buffer and broadcasts; hub has no notion of "how far has a given client consumed."
- `packages/app/components/TerminalView.xterm.tsx:264-266` — create-xterm effect uses deps `[]` by design, preserving mouse/alt-screen modes across WS reconnects.
- `packages/app/components/TerminalView.xterm.tsx:509-634` — WS effect depends on `[scheduleMeasure, sessionGeneration, wsUrl]`; on reconnect (sessionGeneration changes) or on wsUrl change, it closes the old WS and opens a new one, but never touches the xterm buffer.
- `packages/app/components/SplitPaneContainer.tsx:150` — `<TerminalCard>` rendered without `key`, so tab-switching reuses the React subtree (same xterm) with a new `terminal` prop and thus new `wsUrl`.

The protocol change fixes (1). The UI key change fixes (2). Both must ship together — either alone leaves the other bug live.

## 1. Protocol Changes (Hub ↔ Browser)

### 1.1 Hub-side byte sequence tracking

Add `next_seq: u64` per terminal, incremented by the length of every byte chunk appended to that terminal's output buffer. Stored in memory only; not persisted to SQLite (see Decision 1 below).

**Data model additions in `crates/hub/src/machine_manager.rs`:**

- `MachineConnection` gains `output_seq: HashMap<String, u64>` (terminal_id → bytes emitted so far).
- `handle_terminal_output` updates the counter atomically with the buffer extension under the same `machines` lock.
- `subscribe_terminal_output` is extended (new name: `subscribe_terminal_output_from`) to accept `after_seq: Option<u64>` and return one of three resume modes plus the appropriate slice of bytes.

### 1.2 Resume modes

Given `current = output_seq[terminal_id]` and optional `after_seq = N`:

| Input | Resume mode | Bytes sent |
|------|------|------|
| `N` is `None` | `full` | entire `output_buffer` |
| `N == current` | `delta` | empty |
| `current > N` and `current - N ≤ buffer.len()` | `delta` | tail `buffer[buffer.len()-(current-N) .. ]` |
| `current > N` and `current - N > buffer.len()` | `reset` | entire `output_buffer` |
| `N > current` (impossible in normal operation; client ahead of server) | `reset` | entire `output_buffer` |

The last row handles recovery edge cases (e.g., hub crashed and restarted — `next_seq` resets to 0 but the client still holds a large `lastSeenSeq`). Treating it as a reset is safe and conservative.

### 1.3 WebSocket URL parameter

Terminal WS URL accepts an optional `after_seq` query parameter:

```
/ws/terminal/{machine_id}/{terminal_id}?device_id=<id>&after_seq=<u64>
```

Handled in `crates/hub/src/ws.rs::handle_terminal_ws`. Absence is equivalent to `after_seq=None` (initial attach).

### 1.4 New control frames (Hub → Browser, text)

The existing binary channel continues to carry raw PTY bytes. A new JSON control-frame type is added. Client parses text frames at the start of each connection.

**`attach` frame** — always the first frame the hub sends on a new WS:

```json
{ "type": "attach", "seq": 123456, "mode": "full",  "replay_bytes": 65536 }
{ "type": "attach", "seq": 123456, "mode": "delta", "replay_bytes": 128 }
{ "type": "attach", "seq": 123456, "mode": "reset", "replay_bytes": 65536 }
```

`seq` is the hub's `next_seq` *at the moment of subscribe*. `replay_bytes` is the exact number of bytes the hub will deliver across the subsequent binary replay frame(s) (may be split across frames by the existing 8ms batching). After the replay bytes, live output binary frames flow as today.

Mode semantics:
- `full` — initial attach (no `after_seq`). Client writes replay into a fresh xterm.
- `delta` — client's `after_seq` was in range; `replay_bytes` is exactly `seq - after_seq` (possibly 0).
- `reset` — client was out of range or ahead of hub; replay is the full current buffer, and the client MUST call `term.reset()` before writing the replay.

This design lets the client track its position with one invariant: **every binary byte received increments `lastSeenSeq` by 1, without distinguishing replay from live**. The `attach` frame pre-sets `lastSeenSeq = seq - replay_bytes` so that after all replay bytes land, `lastSeenSeq == seq`.

The existing `{"type":"error","message":"…"}` text frame is unchanged.

### 1.5 MOUSE_ENABLE

An earlier draft of this spec kept the existing `ws.rs:154-161` path that emits `\x1b[?1003h\x1b[?1006h` as a server-generated binary frame on every attach. That interacts badly with the resume protocol: the hub deliberately does *not* count those 12 bytes in `output_seq`, but the client counts every binary byte into `lastSeenSeq`, so `after_seq` silently drifts ahead of the hub and every reconnect falls into `AttachMode::Reset` — delta mode never fires.

The hub no longer emits those bytes. Mouse mode is enabled once per xterm instance, by the browser itself, at the end of the create-xterm effect (`TerminalView.xterm.tsx`). Tmux typically re-emits the sequences on attach anyway, so they land in the replay; the client-side write is a safety net for the rare case where they've been evicted from the 64 KB buffer. This keeps the WS byte stream pure PTY history, so `after_seq` and the hub's `output_seq` can never disagree by anything other than genuine pending PTY output.

## 2. Client Changes (Browser)

### 2.1 `lastSeenSeq` tracking in `TerminalView.xterm.tsx`

Add a `useRef<number>(0)` (let's name it `lastSeenSeqRef`) scoped to the component instance. Survives WS effect re-runs because it's a ref, not state, and the component instance is preserved across reconnects by the intentional `[]` deps on the create-xterm effect.

- Reset to `0` only in the create-xterm effect (so it's zero on first mount).
- On receipt of each binary frame, add `chunk.byteLength` to it.
- On reconnect, the WS URL is built with `?after_seq=lastSeenSeqRef.current`.

### 2.2 Attach frame handling

The `ws.onmessage` handler currently treats text frames as potential `{"type":"error"}` and silently returns. Extend it to recognize `attach`:

On receipt of `attach`, set `lastSeenSeqRef.current = seq - replay_bytes` and dispatch on mode:

- `mode === "full"`: no xterm action (xterm is fresh on first mount).
- `mode === "delta"`: no xterm action (xterm already holds prior state).
- `mode === "reset"`: call `term.reset()` synchronously, before processing any subsequent binary frame.

Every binary byte that enters `enqueueOutput` increments `lastSeenSeqRef.current` by `chunk.byteLength`. After all replay bytes are consumed, the counter equals `seq`; after live bytes continue to flow, it tracks the hub's current position.

Implementation detail: use a small state machine in the WS effect — `awaitingAttach` → `streaming`. Binary frames before `attach` are buffered (shouldn't happen in practice but guards against protocol violations).

The frame counter in `orderedBinaryOutput` logic stays. `enqueueOutput` adds to `lastSeenSeqRef.current` at the moment bytes enter the xterm write path.

### 2.3 URL construction

`packages/app/lib/api.ts::terminalWsUrl` currently returns:
```
/ws/terminal/{machineId}/{terminalId}?device_id={deviceId}
```

Add a new signature `terminalWsUrlWithResume(machineId, terminalId, deviceId, afterSeq?)` that conditionally appends `&after_seq=<n>`. The TerminalView's WS effect uses this on reconnect:

```ts
const url = lastSeenSeqRef.current > 0
  ? terminalWsUrlWithResume(machineId, terminalId, deviceId, lastSeenSeqRef.current)
  : wsUrl;
```

### 2.4 `wsUrl` prop stability

`TerminalCard.web.tsx:91-93` builds `wsUrl` from `(machine_id, terminal_id, deviceId)`. These are stable for a given terminal, so once we key by `terminal.id` (section 3), `wsUrl` no longer changes for the lifetime of a TerminalView. Remove `wsUrl` from the WS effect deps and replace with `[scheduleMeasure, sessionGeneration]`. This makes the "WS is rebuilt only on explicit reconnect" invariant explicit in code. Any future regression that tries to change `wsUrl` mid-lifetime will surface as a no-op instead of silently triggering a rebuild.

## 3. UI Changes

### 3.1 Key `TerminalCard` by `terminal.id`

Two locations:

**`packages/app/components/SplitPaneContainer.tsx:150`** — add `key={terminal.id}`:

```tsx
<TerminalCard
  key={terminal.id}
  ref={(el) => { terminalCardRefs.current[terminal.id] = el; }}
  terminal={terminal}
  ...
/>
```

**`packages/app/components/Canvas.web.tsx:280-296`** — the hidden list already keys the wrapper `<div>`, but add `key={terminal.id}` to the inner `<TerminalCard>` for consistency and to keep the React tree unambiguous even if the wrapper div ever changes.

### 3.2 Consequences

After 3.1, switching tabs unmounts the leaving TerminalCard (WS closes, xterm disposes) and mounts a fresh one for the incoming terminal (new xterm, new WS, new `attach(mode=full)`). This is the correct, predictable behavior. Tab switching no longer "preserves" xterm state — but xterm has `scrollback: 0` anyway, so there is no state to preserve. The server's tmux session is the source of truth.

### 3.3 Hidden-list behavior

Hidden terminals still mount TerminalCards (and WebSockets) — their `display: none` is purely visual. With the resume protocol in place, a hidden terminal that later becomes active without remount (rare, but possible if the hidden list → split pane move somehow preserved the instance) still produces zero duplication because the hub sees a `delta` resume and sends nothing if the client is caught up. Defensive, but free.

Do not attempt to defer WS creation for hidden terminals in this change — that's a separate optimization with its own design trade-offs (notifications, auto-attach, etc.).

## 4. Testing

### 4.1 Rust unit tests (`crates/hub/src/machine_manager.rs`)

Add to existing test module:

- `subscribe_from_none_returns_full_replay` — empty `after_seq` yields `mode=full` and entire buffer.
- `subscribe_from_current_seq_returns_empty_delta` — `after_seq == current` yields `mode=delta` with zero-byte replay.
- `subscribe_from_midpoint_returns_tail_slice` — after writing two chunks, subscribing with `after_seq` at the boundary yields `mode=delta` with only the second chunk.
- `subscribe_from_stale_seq_returns_reset` — after buffer rollover (write > 64KB), subscribing with a stale `after_seq` yields `mode=reset` with full buffer.
- `subscribe_from_future_seq_returns_reset` — `after_seq > current` (edge case, hub restart) yields `mode=reset`.
- `output_seq_increments_by_byte_count` — sanity: `next_seq` equals total bytes passed through `handle_terminal_output`.

### 4.2 Rust integration test for the WS handler

Optional — if `ws.rs` is testable via a lightweight fixture. Verifies:
- Text `attach` frame is the first message on a new WS.
- `after_seq` query param is honored.

If the WS handler isn't easily testable, cover this via Playwright E2E below.

### 4.3 Vitest tests for the client

In `packages/app/lib` — extract the resume logic to a pure module (`terminalResume.ts`) to enable unit testing without React:

- `lastSeenSeq` increments per chunk.
- `buildReconnectUrl` appends `after_seq` only when > 0.
- Attach-frame handler dispatches `reset`/`delta`/`full` correctly.

### 4.4 Playwright E2E tests in `e2e/`

New spec files:

**`e2e/terminal-resume.spec.ts`**:

- **WS reconnect, same terminal, no duplicate**: open a terminal, echo `for i in 1..10; echo LINE_$i`, force WS close (via a debug hook or killing the client WS), wait for reconnect, grep xterm for `LINE_1` count — must be exactly 1.
- **Long disconnect triggers reset**: same but generate > 64KB of output while disconnected (via a debug fixture that pauses the client WS write loop but keeps the server emitting) — assert xterm shows recent content only, no stacked duplicates.

**`e2e/terminal-tab-switch.spec.ts`**:

- **Two terminals, alternating switches**: create two terminals, write distinct content to each, switch tabs 5 times, assert each tab's xterm shows only its own content (no cross-bleed).
- **Switch away and back preserves nothing locally (but server replays)**: on switch-back, xterm content matches the server's current buffer (the terminal's real state), not the point-of-switch snapshot.

### 4.5 Manual verification checklist

- Toggle airplane mode for 5 seconds on a laptop → no duplicated lines in the terminal after reconnect.
- Switch tabs rapidly between two busy terminals (e.g., two `top` sessions) → each tab shows only its own content; no residual pixels on switch (scrollwheel not required to "fix" the display).
- Hub restart → all terminals show a full replay (`mode=full`) without duplication.
- Open the same user on desktop + mobile → both see the terminal without duplicated content across their independent WS attaches.

## 5. Migration and Rollout

Protocol compatibility is asymmetric: the hub and the browser are both shipped together in this project (single artifact, single auth scope). There is no need for a phased rollout. However, to keep the change mergeable in pieces if desired:

- Phase A — hub emits `attach` frame and tracks `next_seq`, ignores incoming `after_seq`. Browser keeps current behavior. No user-visible change; all deltas are `full`.
- Phase B — hub honors `after_seq`. Browser tracks `lastSeenSeq`, sends it on reconnect, handles `delta`/`reset`. First user-visible fix ships.
- Phase C — UI `key={terminal.id}` lands. Tab-switch fix ships.

A–B may merge together or in two PRs; C is independent. No backward-compatibility shim is needed beyond what falls out naturally (hub without the change would ignore `after_seq`; client without the change would ignore `attach`). The failure mode is the pre-fix behavior, so no regressions.

## 6. Risks and Open Questions

- **Reset frequency** — if users regularly hit the 64KB threshold during disconnects (heavy `tail -f`, build logs), they'll see a `reset` every time. `reset` is visually equivalent to current behavior (a full-buffer write that overlaps) UNTIL we pair it with `term.reset()`. With `term.reset()` the screen briefly clears and the full buffer redraws — this is the correct and expected fallback, but it is a brief visible flicker. Acceptable; the alternative is raising the buffer size, which we deliberately deferred (decision 2).
- **Ordering guarantee** — the spec assumes `attach` text frame arrives before any binary frame from the same connection. `tungstenite` and standard browser WS clients preserve ordering, so this holds. Defensive coding in the client's state machine still worth it.
- **Seq accuracy on output from the hub itself** — the WS byte stream now contains only machine-originated PTY bytes accounted for in `output_seq`. `MOUSE_ENABLE` is written locally by the client (section 1.5), so there is no hub-generated binary that has to be specially excluded. If a future change re-introduces hub-generated binary traffic, it must be counted in `output_seq` or moved to a non-counted control channel (text frame) — otherwise the client's per-byte accumulator will drift.
- **Unit-testability of `subscribe_terminal_output_from`** — need to confirm the existing test harness (`test_db()`, `register_machine`) supports driving bytes through `handle_terminal_output` and reading back the result via subscribe. Spot check during planning; if awkward, restructure the function for testability before adding cases.
- **Interaction with `wterm` renderer variant** — `TerminalView.wterm.tsx` is an alternative renderer (opt-in via localStorage). This spec targets `TerminalView.xterm.tsx`. The wterm variant should receive equivalent changes in a follow-up; for this change, document that `webmux:renderer=wterm` retains the old behavior until ported.
- **Android/WebView variant** (`TerminalView.android.tsx`) — does not use xterm directly; the bridge forwards bytes into a WebView-hosted xterm. Same protocol changes apply but the client state machine sits on the native side. Handle in the same PR or immediately after.

## 7. Decisions (Committed)

1. Hub-side `next_seq` lives in memory only, not persisted. Hub restart → clients see one `reset` (or `full` on fresh connect), no harm done.
2. Output buffer stays at 64KB. Tuning deferred; revisit only if `reset` frequency is observed to be annoying.
3. Hidden-list terminals still maintain live WS connections; the resume protocol makes this safe. Deferred-WS optimization is out of scope.
4. `lastSeenSeq` lives in `useRef` on each TerminalView instance. Once TerminalCard is keyed by terminal.id, the lifetime is exactly one mount per terminal-tab association, which is the correct scope.
5. Control messages use JSON text frames. Binary frames remain opaque byte payloads.

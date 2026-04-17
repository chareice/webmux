# Per-client tmux attach: redesigning hub as transparent fanout

**Status**: design approved, implementation pending
**Date**: 2026-04-17
**Supersedes**: substantial parts of `2026-04-17-terminal-resume-protocol-design.md` (the byte-seq resume protocol it introduced is removed by this redesign; the React `key={terminal.id}` fix it introduced is preserved).

## Problem

The hub keeps a per-terminal 64KB sliding byte buffer (`crates/hub/src/machine_manager.rs:967–970`). When new bytes from the machine push the buffer past 64KB, `Vec::drain(..)` slices off the leading bytes at an arbitrary byte boundary. ANSI escape sequences are multi-byte and indivisible — when a slice lands inside one (e.g. mid-`\x1b[38;5;NNm`), the surviving prefix becomes orphan parameter text. A new client attaching with `AttachMode::Full` receives that trimmed buffer as its initial replay, and xterm parses the orphan parameters as printable characters.

This is not just a fix-the-bytes-are-truncated bug — it is a structural mismatch. The byte stream emitted by tmux has internal structure (CSI / OSC / DCS / UTF-8 multi-byte). Any code path that operates on those bytes as a flat buffer is at risk of slicing through that structure. The full class includes (but is not limited to) SGR truncation; OSC and DCS sequences, UTF-8 multi-byte characters, and partial escape sequences in the resume delta path are all latent variants of the same problem.

End-to-end reproduction (failed reproduction spec already exists at `e2e/tests/terminal-buffer-trim.spec.ts`) confirms ~10% of fresh attaches under continuous SGR-heavy output get a buffer whose first byte is a CSI parameter character.

## Goals

- Eliminate the entire class of "byte-buffer truncated mid-sequence" bugs structurally, not patch one symptom.
- Hub becomes a stateless transparent fanout layer: byte in, byte out, no per-terminal byte buffer, no seq counter, no resume protocol.
- Use tmux's native multi-client capability as the single source of authority for terminal state and replay.

## Non-goals

- Changing the browser-side renderer (still xterm.js + WebGL).
- Changing terminal-persistence semantics (tmux sessions still survive `webmux-node` restarts; they do not survive tmux server restart, which is unchanged).
- Adding or removing user-visible features (split panes, multi-device collaboration, mobile, control lease).
- Performance — this redesign is for correctness and simplification, not speed.

## Architecture

### Today

```
browser xterm ──WS──► hub ──WS──► machine ──PTY──► one tmux attach ──► tmux session ──► shell
                       │
                       ├─ output_buffers: HashMap<terminal_id, Vec<u8>>     (64KB sliding)
                       ├─ output_seqs: HashMap<terminal_id, u64>            (resume counter)
                       ├─ output_channels: HashMap<terminal_id, broadcast>  (in-process fanout to N WS)
                       └─ AttachMode {Full, Delta, Reset}                   (resume protocol)
```

Hub maintains all replay state. Machine maintains a single tmux client per terminal and broadcasts its bytes.

### After

```
browser_1 xterm ──WS──► hub ──WS──► machine ──PTY──► tmux attach #A ─┐
browser_2 xterm ──WS──► hub ──WS──► machine ──PTY──► tmux attach #B ─┼── tmux session ──► shell
browser_3 xterm ──WS──► hub ──WS──► machine ──PTY──► tmux attach #C ─┘
                       │
                       ├─ HubRouter:
                       │   attach_id ↔ WS sender
                       │   attach_id → terminal_id (for cleanup lookup)
                       └─ terminal records (sqlite-backed, unchanged)
```

Hub holds **only routing tables** in memory — no byte buffer, no seq counter, no broadcast, no replay protocol. Machine holds one `tmux attach` subprocess per browser-side WebSocket. Each browser is end-to-end an independent byte pipe through hub. tmux itself handles the snapshot+live byte ordering for each newly attached client (this is what tmux's multi-client design is for).

## Attach lifecycle

### Open (browser opens WS to hub)

1. Browser establishes WS to hub: `/ws/terminal/{machine_id}/{terminal_id}?token=...&device_id=...`
2. Hub authenticates, generates a fresh `attach_id` (UUID).
3. Hub sends `OpenAttach { attach_id, terminal_id, cols, rows }` to machine over the existing hub↔machine WS.
4. Hub records `attach_id → ws_sender` and `attach_id → terminal_id` in its router.
5. Machine receives `OpenAttach`: spawns a new task that opens a PTY, spawns `tmux attach-session -t <session>` as the child process, registers the attach in its `AttachManager`.
6. tmux server sees a new client: emits the standard "client attach" sequence — terminal init, alt-screen entry (if applicable), full repaint of the current pane state.
7. Machine's per-attach reader thread reads PTY bytes → wraps in `AttachOutput { attach_id, data }` → sends to hub.
8. Hub routes by `attach_id` to the corresponding WS sender → forwards binary frame to browser.
9. Browser's xterm.js writes the bytes; the repaint covers the screen with the current state.

There is no separate "give me the snapshot" call. The snapshot is the tmux client's natural attach repaint; the live updates are the same client's continued PTY output. The two are one continuous, internally consistent byte stream that tmux generates for every new attached client.

### Input (user types)

1. Browser xterm emits a key event → forwards via WS as `{type: "input", data}`.
2. Hub looks up which `attach_id` this WS owns → sends `AttachInput { attach_id, data }` to machine.
3. Machine writes the bytes to that attach's PTY (the writer side of the pair owned by that attach task).
4. tmux receives the input via the attach's PTY → routes to the shell.
5. Shell processes the input, writes echo bytes back.
6. tmux propagates the echo to **all** attached clients via their respective PTYs (this is tmux's multi-client behavior — every client sees every change).
7. Each attach's reader thread → `AttachOutput { attach_id, data }` → hub → respective browser WS.

Result: the typing browser sees its own echo. Other browsers attached to the same terminal also see the echo. No special handling needed — tmux does the multi-client fanout for us.

### Resize (controller-driven)

`tmux.conf` template adds `set -g window-size manual`. tmux no longer auto-resizes the window when clients attach/detach or report different sizes. The window stays at whatever size we explicitly set with `tmux resize-window`.

1. Controller browser detects viewport / fit-to-window change → sends `{type: "resize", cols, rows}` over its WS.
2. Hub validates the WS belongs to the device that currently holds the control lease for this machine. Non-controllers get dropped (defense in depth — the client shouldn't send resize if not controller, but we enforce server-side too).
3. Hub forwards as `AttachResize { attach_id, cols, rows }` to machine.
4. Machine's attach task calls `tmux resize-window -t <session> -x cols -y rows` (subprocess RPC, not a write to the attach's PTY — this is a tmux server command, applied globally to the session).
5. tmux server changes the window size; emits a redraw to **all** attached clients with the new size's content.
6. Each attach reads the redraw bytes from its PTY → forwards to its browser.
7. Machine also emits `TerminalResized { terminal_id, cols, rows }` so hub broadcasts to all browsers (including non-controller observers) so their xterm instances can `term.resize(cols, rows)` to match.

Non-controller browsers see the new size in the redraw; their xterm matches via the broadcast event. Their CSS scaling (already implemented in immersive mode) handles "session is bigger/smaller than my viewport".

### Close (browser closes WS)

Normal close (tab close, navigation, `term.dispose()`):

1. Browser WS closes.
2. Hub's per-WS task observes the close.
3. Hub sends `CloseAttach { attach_id }` to machine.
4. Hub removes routing entries for this `attach_id`.
5. Machine receives `CloseAttach`: cancels the attach task → sends SIGTERM to the `tmux attach` child process → reaps it → removes attach from its `AttachManager`.
6. tmux session continues running (other attaches stay; if this was the last one, the session is detached but alive).

### Attach dies abnormally (tmux session ends, kill -9, etc.)

1. Machine's attach reader hits PTY EOF or read error.
2. Attach task reaps the child (if any), determines reason, sends `AttachDied { attach_id, reason }` to hub.
3. Hub routes by `attach_id` → finds the browser WS → sends a "terminal exited" notification (or closes the WS with an appropriate close code) → removes routing entries.
4. Browser shows "terminal exited" UI state (existing behavior, just triggered via a new path).

### Hub fails over / restart

1. Hub-machine WS dies on the machine side.
2. Machine cancels all attach tasks: SIGTERMs every `tmux attach` child it owns. tmux sessions themselves are children of the tmux server (independent process), so they keep running.
3. Browser-hub WS dies; browsers preserve their xterm instances and enter reconnect.
4. Hub restarts; machine reconnects; sends `ExistingTerminals` (from its in-memory + persisted session list, validated against `tmux ls`).
5. Browsers reconnect; each reconnected WS triggers fresh `OpenAttach` → new `tmux attach` on machine → fresh repaint flows back → browser's preserved xterm gets `\x1b[H\x1b[2J` + redraw, smoothly overwriting the stale frozen content.

No data is lost; the only user-visible effect is a brief disconnect indicator and a content "jump" to current state.

### Machine restart

1. Machine process dies; all `tmux attach` children die with it (parent-child relationship). tmux sessions keep running (separate tmux server process).
2. Hub-machine WS dies on hub side; hub marks machine offline; notifies browsers.
3. Machine restarts; reads `sessions.json` from disk; runs `tmux ls` to verify which sessions are still alive (purges entries for dead ones).
4. Machine reconnects to hub; sends `ExistingTerminals` with verified-alive list.
5. Hub re-registers terminals; notifies browsers "machine online".
6. Browsers' WS may have been closed by hub on machine-offline (existing behavior); they reconnect → fresh attach → fresh repaint.

The `pty.capture_scrollback()` call in `crates/machine/src/hub_conn.rs:128` (which currently seeds the hub's byte buffer with a tmux capture-pane snapshot on machine reconnect) is removed: the hub no longer has a buffer to seed, and browsers' fresh attaches get the snapshot via the natural tmux attach repaint anyway.

### Tmux server restart / system reboot

Genuinely lossy. Behavior unchanged from today: machine sees empty `tmux ls`, marks all its tracked sessions as dead, emits `TerminalDied` for each, hub notifies browsers, terminals disappear from the UI. Out of scope for this redesign.

## Hub↔machine protocol changes

Existing terminal-level messages are unchanged:

- `HubToMachine::CreateTerminal { request_id, cwd, cols, rows, startup_command, ... }`
- `HubToMachine::DestroyTerminal { terminal_id }`
- `MachineToHub::TerminalCreated { request_id, terminal_id, title, cwd, cols, rows }`
- `MachineToHub::ExistingTerminals { terminals }`

New attach-level messages:

| Direction | Variant | Fields |
|---|---|---|
| Hub→Machine | `OpenAttach` | `attach_id`, `terminal_id`, `cols`, `rows` |
| Hub→Machine | `CloseAttach` | `attach_id` |
| Hub→Machine | `AttachInput` | `attach_id`, `data` (bytes) |
| Hub→Machine | `AttachResize` | `attach_id`, `cols`, `rows` |
| Hub→Machine | `AttachImagePaste` | `attach_id`, `data` (base64), `mime`, `filename` |
| Machine→Hub | `AttachOutput` | `attach_id`, `data` (bytes) |
| Machine→Hub | `AttachDied` | `attach_id`, `reason` (enum: SessionEnded / ProcessKilled / IoError) |
| Machine→Hub | `TerminalDied` | `terminal_id`, `reason` |
| Machine→Hub | `TerminalResized` | `terminal_id`, `cols`, `rows` (broadcast to all observers when controller resizes) |

Removed messages:

- `HubToMachine::TerminalInput`, `TerminalResize`, `TerminalImagePaste` (replaced by per-attach equivalents)
- `MachineToHub::TerminalOutput` (replaced by `AttachOutput`)
- `ServerMessage::Attach { seq, mode, replay_bytes }` (the WS text frame announcing replay semantics — gone with the resume protocol)

WS query parameter `?after_seq=N` is removed (silently ignored if a stale client sends it, which they shouldn't if hub and client are upgraded together).

## Code that goes away

### Hub (`crates/hub/`)

- `MachineConnection.output_buffers: HashMap<String, Vec<u8>>`
- `MachineConnection.output_seqs: HashMap<String, u64>`
- `MachineConnection.output_channels: HashMap<String, broadcast::Sender<Bytes>>`
- `AttachMode { Full, Delta, Reset }` enum and all related tests
- `TerminalSubscription` struct
- `subscribe_terminal_output()` and `subscribe_terminal_output_from()` methods
- `handle_terminal_output()` (replaced by a small per-attach router function)
- `ServerMessage::Attach { ... }` variant
- `ws.rs` parsing of `?after_seq=` and the entire resume handling block

### Machine (`crates/machine/`)

- `output_buffer: Arc<Mutex<Vec<u8>>>` per session
- `output_tx: broadcast::Sender<Bytes>` per session, `BROADCAST_CAPACITY`
- `pty.subscribe()` returning `(buffer, rx)`
- `pty.capture_scrollback()` (no consumer left)
- `attach_to_tmux()` (the always-on single-client attach)
- `reattach_tmux()` (auto-reattach machinery — per-client model means an attach death notifies the browser, which reconnects with a new attach instead of the machine silently rebuilding state)
- `DetachNotifier` and the detach event channel
- `ensure_attached()` and related state guards
- The buffer-maintenance branch in `spawn_reader_thread`

### Direct PTY mode (entirely removed; tmux is now mandatory)

- `create_terminal_direct()` and its supporting helpers
- `is_shell_command()` check (only used by direct mode)
- `PtyManager::new()` fall-back-to-direct branch
- `check_tmux_available()` keeps detection but the failure semantics change: `webmux-node start` now refuses to come up if tmux is missing, instead of falling back. The `install.sh` script also gains an explicit tmux check with an actionable install hint.

### Client (`packages/app/`)

- `lib/terminalResume.ts` (entire file)
- `lib/terminalResume.test.ts` (entire file)
- In `components/TerminalView.xterm.tsx`:
  - `lastSeenSeqRef`
  - `appendResumeSeq` call when building the WS URL
  - The `parseAttachFrame` block in `ws.onmessage`
  - The `needsReset` flag + the `mode === "reset"` `term.reset()` path
  - The byte-counting in `flushPending` for `lastSeenSeq` advancement
  - The long resume-protocol comments

The xterm-instance-preservation across WS reconnect (mount-once `useEffect`) is **kept** — purely as an UX optimization (no flash on brief blips). The fresh-attach-on-reconnect path now overwrites preserved content cleanly because tmux's repaint always begins with `\x1b[H\x1b[2J`.

### Tests

- Vitest: `lib/terminalResume.test.ts` deleted.
- Hub unit tests: ~15 tests covering `AttachMode` / `subscribe_terminal_output_from` / buffer-trim behavior deleted; ~5 new tests covering `HubRouter` routing + control-lease resize gating added.
- E2E: `terminal-resume.spec.ts` deleted (the protocol it tests no longer exists). `terminal-buffer-trim.spec.ts` deleted (the bug class no longer exists). `terminal-tab-switch.spec.ts` kept (the React `key={terminal.id}` fix is still meaningful).
- New E2E: `terminal-multi-attach.spec.ts` (multiple browsers attached to one terminal — verify each receives correct content; verify input from one is echoed to all). `terminal-attach-recovery.spec.ts` (hub restart + machine restart recovery flows).

## Mandatory-tmux rollout

Two layers, both enforced:

1. **Install-time** (`install.sh` / desktop installer): probe for `tmux` in PATH; if missing, print platform-specific install hint and abort install.
2. **Machine startup**: `webmux-node start` runs `tmux -V` as its first step. If absent, print the same install hint and exit non-zero. The machine never registers with the hub in a "tmux-less" state.

Both are needed because users may bypass `install.sh` (CI images, hand-copied binaries).

## Migration

Wire-protocol-incompatible: old machines do not understand `OpenAttach` etc.; the new hub no longer emits `TerminalInput`. Webmux is self-hosted and ships hub + machine + client from the same release tag, so:

- New hub registering an old machine: hub sends `OpenAttach`, old machine returns "unknown message", hub closes connection with a "version mismatch — please upgrade your webmux-node" reason. Browsers see the machine as offline with that error message.
- A simple version handshake on the hub-machine WS (already half-present in current code) is extended to fail-fast on incompatible versions rather than waiting for a confused message exchange.

No on-disk state migration is needed: `sessions.json` schema is unchanged; tmux sessions on disk (handled by tmux server) are unchanged.

## Implementation order

The implementation plan (separate document, produced via `superpowers:writing-plans` after this design is approved) will sequence the work so each step compiles, tests pass, and the system remains usable. Roughly:

1. Hub: introduce `HubRouter` data structure alongside existing buffer code (no behavior change yet).
2. Protocol: add new message variants, keep old ones for one step.
3. Machine: add `AttachManager`, `SessionWatcher`. Keep old single-attach code for one step.
4. Machine: wire `OpenAttach` to spawn per-client tmux attach.
5. Hub: switch the `/ws/terminal` handler to use `OpenAttach` instead of `subscribe_terminal_output_from`.
6. Client: drop `terminalResume.ts` and the resume logic in `TerminalView.xterm.tsx`.
7. Strip the now-dead old code (output_buffers, AttachMode, broadcast, single-attach machinery, direct PTY mode).
8. Mandatory-tmux check in `webmux-node start` and `install.sh`.
9. Tmux config: `window-size manual` + `tmux resize-window` calls in `AttachResize` handler.
10. New E2E specs; remove obsolete ones.

## Risk and rollback

- Per-client tmux attach is a known, well-supported tmux capability — not novel infrastructure. Failure modes are bounded by tmux's well-tested multi-client behavior.
- Mandatory tmux is a hard breaking change for users on tmux-less setups. Release notes must call this out prominently.
- Rollback: revert to previous release; sessions on disk (`sessions.json` + tmux server state) are forward-and-backward compatible because the schema didn't change.

# Perf: input latency, scroll smoothness, mobile IME duplicates

Branch `perf-input-scroll` (worktree). Goal: close the gap to a raw SSH
terminal — keystroke echo latency, scroll feel, and mobile duplicate
characters (WeChat IME).

## Background / root causes (already diagnosed, do not re-derive)

1. **TCP_NODELAY was never set anywhere.** axum does not set it on accepted
   connections (axum issue #2521); tokio-tungstenite's `connect_async` leaves
   Nagle on for the machine→hub leg — exactly the direction keystroke echoes
   travel. Nagle + delayed-ACK on a continuous small-frame stream causes
   tens-of-ms stalls.
2. **Frontend output waits one rAF before `term.write`** in
   `packages/app/components/useTerminalLiveSocket.ts` — every echo pays
   0–16 ms extra before xterm even parses it.
3. **Scroll is line-quantized and over-amplified.** All scrollback is tmux
   copy-mode (xterm `scrollback: 0`; wheel → SGR mouse reports). xterm's
   pixel-delta path: `reports = deltaY * scrollSensitivity / cellHeight *
   0.3 (trackpad damp)`. With `scrollSensitivity: 6` and tmux's default
   copy-mode wheel binding of **5 lines per report**, one line of trackpad
   travel scrolled ~9 lines in 5-line lurches. Mobile touch synthesizes one
   WheelEvent per line of finger travel, so it was ~9x too fast as well, and
   had no fling momentum (finger lift = dead stop).
4. **Mobile duplicate characters** are xterm CompositionHelper bugs fixed
   upstream *after* 6.0.0 (middle-of-textarea composition fix 2026-02,
   composition suffix fix 2026-03, `autocomplete="off"` on the helper
   textarea 2026-08). They exist only in `6.1.0-beta.*`. Hence the beta
   upgrade below.

## Changes ALREADY MADE in this worktree (review, fix if wrong, keep intent)

- `crates/hub/src/main.rs` — `axum::serve::ListenerExt::tap_io` sets
  `set_nodelay(true)` on accepted connections.
- `crates/machine/src/hub_conn.rs` — after `connect_async`, digs the
  `TcpStream` out of `MaybeTlsStream` (Plain / Rustls) and sets nodelay.
- `crates/machine/src/pty.rs` — generated tmux config now overrides
  copy-mode + copy-mode-vi `WheelUpPane`/`WheelDownPane` to
  `select-pane \; send -N1 -X scroll-up|down` (1 line per report instead of
  tmux's 5). Test `tmux_config_contains_mouse_and_clipboard` extended to
  assert the four bindings. `cargo test -p tc-machine` and
  `cargo check -p tc-hub -p tc-machine` pass as of these edits.
- `packages/app/package.json` — xterm upgraded to `6.1.0-beta.303` with
  addons `webgl 0.20.0-beta.299`, `fit 0.12.0-beta.300`,
  `clipboard 0.3.0-beta.302`, `web-links 0.13.0-beta.300` (these exact pins
  are peer-compatible; webgl's peer range is `^6.1.0-beta.303`).
  `pnpm install` already run.
- `packages/app/components/TerminalView.xterm.tsx`:
  - `patchScaledMouseCoordinates` now looks for the service on
    `_core._mouseCoordsService` (6.1 split) falling back to
    `_core._mouseService` (6.0), requiring both `getCoords` and
    `getMouseReportCoords` to be functions.
  - `TERMINAL_SCROLL_SENSITIVITY` 6 → 3 (with tmux N1 this gives ~1 line
    scrolled per cell-height of trackpad/finger travel; comment explains).
  - Touch scroll refactored: shared `scrollByPixels(dy, x, y)` feeding the
    per-line synthetic WheelEvent loop, plus **fling momentum** — velocity
    from touchmove samples in the last 100 ms, rAF decay loop
    (`MOMENTUM_DECAY 0.94` per 16.7 ms frame, start ≥ 0.4 px/ms, floor
    0.05 px/ms), `stopMomentum()` on touchstart/unmount, and a
    `tapInterruptedMomentum` guard so a tap that stops a fling doesn't
    activate a link under the finger.
- `packages/app/lib/terminalInputBatcher.ts` — NEW, `createInputBatcher`:
  coalesces same-tick input pushes into one string, flushes in a microtask
  (injectable `schedule` for tests), `flush()` for manual ordering barriers.
  **Not wired up yet, no tests yet.**

## Remaining tasks (implement these)

### 1. Wire the input batcher into `TerminalView.xterm.tsx`

- Create the batcher inside the mount effect (where `term.onData` is
  registered). Its `send` callback does the current guarded send:
  `ws.readyState === OPEN && canTypeRef.current` →
  `ws.send(JSON.stringify({ type: "input", data }))` (guards evaluated at
  flush time, i.e. inside the callback).
- `term.onData` handler: keep `filterBrowserGeneratedTerminalInput` and the
  `inputTransformRef` transform per chunk, then `batcher.push(transformed)`
  instead of direct `ws.send`.
- Store the batcher in a ref so the imperative `sendInput` (useImperativeHandle)
  routes through the same batcher (fall back to direct send if the ref is
  null). This keeps key-bar input ordered with onData input.
- `sendCommandInput`, `sendImageFile` (imperative), and the internal
  `sendFileToWs` must call `batcher.flush()` **before** sending their own
  message, so input/command/image ordering is preserved.
- On effect cleanup, `flush()` the batcher before the WS/terminal teardown.

### 2. Unit tests for the batcher

`packages/app/lib/terminalInputBatcher.test.ts` (vitest, follow the style of
existing lib tests, e.g. `terminalInputFilter.test.ts`):
- same-tick pushes coalesce into one send with concatenated data, order kept;
- a manual `flush()` sends immediately and the later scheduled flush is a
  no-op;
- pushes after a flush start a new batch;
- single push sends the identical string (no join overhead path).

### 3. Immediate first write in `useTerminalLiveSocket.ts`

Change `enqueueOutput` so the **first chunk in an idle frame is written
synchronously** and only follow-up chunks batch to the next rAF:

```ts
const enqueueOutput = (chunk: Uint8Array) => {
  if (!rafId && pendingBytes === 0) {
    // Interactive path: nothing queued this frame — write immediately so a
    // keystroke echo doesn't wait for the next animation frame. The rAF is
    // a burst marker: chunks arriving before it fires get batched.
    term.write(chunk);
    rafId = requestAnimationFrame(flushPending);
    return;
  }
  pendingChunks.push(chunk);
  pendingBytes += chunk.length;
  if (pendingBytes >= MAX_PENDING_OUTPUT_BYTES) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    flushPending();
  }
};
```

`flushPending` already no-ops on empty pending and resets `rafId` — verify
that stays true. Ordering must be preserved (single writer).

### 4. Passive echo-latency probe (diagnostic, gated)

Only active when `localStorage.getItem("webmux:echo-probe") === "1"`:
- In TerminalView, record `performance.now()` into a shared ref whenever an
  input batch is actually sent.
- In `useTerminalLiveSocket.enqueueOutput`, if a probe timestamp is pending
  and the output arrives within 2000 ms, record `now - t` as one sample and
  clear the pending timestamp (first output after an input approximates the
  echo round trip).
- Keep an EMA (α = 0.2), a last sample, and a count on
  `window.__webmuxEcho[terminalId] = { last, ema, n }`; `console.log` a
  one-line summary every 20 samples. A few dozen lines total, zero cost when
  the flag is off. Pass the shared ref through the existing
  `UseTerminalLiveSocketOptions`.

### 5. Post-upgrade audit (xterm 6.1.0-beta)

- `grep -rn "_core" packages/app --include="*.ts" --include="*.tsx"` (excluding
  node_modules/tests) — for every internal-API touchpoint, verify the field
  still exists in `packages/app/node_modules/@xterm/xterm/lib/xterm.js` /
  the webgl addon bundle (string-search is fine; xterm does not mangle
  property names). Known touchpoints: `patchScaledMouseCoordinates`
  (already adapted), `lib/terminalGpuRenderer.ts` (uses public addon API
  `clearTextureAtlas` / `onContextLoss` — both confirmed present).
- Check `e2e/tests/terminal-copy-mode-scroll.spec.ts` (and any other spec
  touching scroll, grep for `scroll` under e2e/tests) for assertions that
  assume the old 5-lines-per-report behavior or sensitivity 6; adjust
  expected scroll distances to the new model (1 line per report,
  sensitivity 3). Do NOT run the docker e2e stack — static adjustment only,
  CI will run it.

### 6. Verification (run all, fix failures)

```sh
cargo test -p tc-machine -p tc-hub
pnpm test          # vitest at repo root
pnpm typecheck     # tsc -b
pnpm build         # expo export --platform web — must bundle the beta cleanly
```

Do not commit; leave the worktree dirty for review.

## Constraints

- Don't touch the e2e docker environment (another run may be in progress).
- Don't refactor beyond the spec; match surrounding code style and comment
  density. Comments state constraints, not narration.
- Mobile behavior (IME duplicates, touch momentum feel) can only be truly
  verified on-device by the user afterward — do not claim device-level
  verification.

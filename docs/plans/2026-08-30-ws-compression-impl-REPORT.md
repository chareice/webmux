# Implement: end-to-end terminal output compression (deflate-raw-v1) — IMPL REPORT

- Date: 2026-08-30
- Branch: `perf-ws-compression` (worktree `perf-input-scroll`)
- Spec: `docs/plans/2026-08-30-ws-compression-impl.md`
- Status: IN PROGRESS (findings appended incrementally)

## Log

### Step 0 — exploration done

Verified starting points match the spec:

- Hub terminal WS: `crates/hub/src/ws.rs` `terminal_ws_handler` /
  `handle_terminal_ws`; query params already parsed via
  `Query<HashMap<String, String>>`. `ServerMessage` is a hub-local enum in
  `ws.rs` (only `Error` today) — the `CompressionEnabled` ack variant goes
  there. Outbound `send_task` merges chunks and is payload-agnostic.
- Hub machine registry: `MachineManager::register_machine`
  (`crates/hub/src/machine_manager.rs:154`), per-machine state in
  `MachineConnection` (:60). `register_machine` has ~30 test callsites, so the
  capability lands via a delegating variant rather than a signature change.
- Machine hello: `MachineToHub::Register` (`crates/protocol/src/lib.rs:326`),
  processed in `handle_machine_ws` (`ws.rs:523`).
- Machine attach + send loop: `crates/machine/src/hub_conn.rs` —
  `coalesce_outbound_batch` (:39) merges adjacent same-attach chunks; the send
  task (:349) feeds merged frames to the sink. Compression hooks in after the
  merge, per outgoing WS message.
- Browser: `packages/app/components/useTerminalLiveSocket.ts` (binary path at
  :142, text frames currently ignored at :143), WS URL built in
  `packages/app/lib/api.ts:388` (`terminalWsUrl`), sole caller
  `TerminalCard.web.tsx:274`.
- E2E: helpers expose `__webmuxTerminals` (buffer reads) gated on
  `localStorage webmux:e2e=1`; `__webmuxEcho` pattern lives in
  `useTerminalLiveSocket.ts:88`.

### Steps 1-5 — Rust + protocol implemented

- `Cargo.toml` / `Cargo.lock` 0.26→0.28 bump committed separately as
  `6a5706a` (no other changes in that commit).
- `crates/protocol`: `MachineToHub::Register.capabilities: Vec<String>`
  (`#[serde(default)]`), `HubToMachine::OpenAttach.compress: bool`
  (`#[serde(default)]`). Serde compat tests prove old-format messages (no
  `compress`, no `capabilities`) still deserialize.
- Codec: `crates/protocol/src/compression.rs` — `AttachCompressor` /
  `AttachInflater` over flate2. Backend note: used the **default miniz_oxide
  backend**, not zlib-rs — verified in the vendored flate2 1.1.10 source that
  `Compress::new` uses `MZ_DEFAULT_WINDOW_BITS` (=15), so window-bits control
  via the zlib-rs-gated `new_with_window_bits` is unnecessary. Raw deflate
  (`zlib_header=false`), level 6, `FlushCompress::Sync` per message with the
  `00 00 ff ff` tail kept on the wire. Round-trip tests cover: message
  stream integrity, arbitrary input splits (merge simulation), the kept sync
  flush tail, and context takeover (repeat block compresses >4x better the
  second time).
- Machine (`crates/machine/src/hub_conn.rs`): Register advertises
  `capabilities: ["deflate-raw-v1"]`. New channel control message
  `OutboundHubMessage::AttachCompression { attach_id, enable }` flows through
  the same ordered send channel as output, so the send task's per-attach
  compressor map is updated strictly before/after that attach's chunks.
  Compression applies in the send task AFTER `coalesce_outbound_batch`
  merging, one sync flush per WS message. Compressor dropped on CloseAttach
  and on AttachDied.
- Hub: `MachineConnection.capabilities` +
  `MachineManager::machine_supports()`; `register_machine` keeps its old
  signature (30+ test callsites) and delegates to
  `register_machine_with_capabilities`. `handle_terminal_ws` negotiates:
  browser query param `compress=deflate-raw-v1` AND machine capability →
  sends `ServerMessage::CompressionEnabled { algo: "deflate-raw-v1" }` text
  frame BEFORE dispatching `OpenAttach { compress: true }` (and before the
  send_task that owns the sink exists), so no binary frame can precede the
  ack. Preview attaches hardcode `compress: false`. CRIME-class security note
  placed at the capability recording site in `handle_machine_ws`.
- Browser: `fflate@0.8.3` exact-pinned in `packages/app`. New isolable module
  `packages/app/lib/attachCompression.ts` (ack gating, sync `Inflate` push,
  chunks copied out of fflate's reused 32 KiB window buffer, fail-closed
  error path) + `attachCompression.test.ts` (vitest). Wired into
  `useTerminalLiveSocket.ts`; ack sets `window.__webmuxCompression[terminalId]`
  mirroring `__webmuxEcho`. URL param added in `lib/api.ts terminalWsUrl`
  with the `webmux:compress === "off"` escape hatch (unset by default →
  compression ON in e2e).
- E2E: wrote `e2e/tests/terminal-compression.spec.ts` (ack flag + `seq 1
  2000` tail integrity). NOT run — docker e2e stack is reserved by another
  task.

### Step 6 — bug found during verification

`AttachCompressor::compress_message` first used "input consumed && total_out
stalled" as the loop exit. That never terminates: a `FlushCompress::Sync`
call with empty input re-emits an empty stored block (`00 00 ff ff`) on
every call, so `total_out` advances forever (all 4 codec tests spun at 100%
CPU). Fixed the exit condition to "input consumed AND the previous call did
not fill the output buffer" (`crates/protocol/src/compression.rs`). Also
corrected the context-takeover test to compare a warm compressor against a
fresh one (the intra-message repetition already compresses the first block
well, so first-vs-second within one compressor understates takeover).

### Step 7 — verification results (all run, all green)

- `cargo test --workspace --offline`: machine 39 ok, protocol 21 ok (codec
  round-trip incl. arbitrary splits, sync-flush tail on wire, takeover,
  serde old-peer compat), hub 98 ok, cli 49 ok.
- `cargo check --workspace --all-targets --offline`: green, zero warnings.
- `pnpm test` (vitest): 41 files / 331 tests ok, incl. new
  `attachCompression.test.ts` (ack gating, unknown-algo refusal,
  split/merge stream integrity, fail-closed error path).
- `pnpm typecheck` (`tsc -b`): green.
- `pnpm build` (expo export web): green.
- e2e: NOT run (docker stack reserved by another task, per spec).
  `e2e/tests/terminal-compression.spec.ts` written; compression is ON by
  default in the e2e env (opt-out via `localStorage webmux:compress=off`,
  unset in e2e), so the existing suite becomes the compression regression
  test the next time it runs.
- Note: cargo needed `--offline` in this environment — a plain `cargo test`
  hangs indefinitely trying to reach crates.io; all deps were already
  vendored/cached.

### Final state

Uncommitted changes (left for review, per spec): root `Cargo.toml` +
`Cargo.lock` (flate2 workspace dep), `crates/protocol` (compression module,
Register/OpenAttach fields, tests), `crates/machine` (capabilities +
per-attach compressor), `crates/hub` (capability registry, negotiation,
ack), `packages/app` (fflate 0.8.3 exact pin, attachCompression module +
test, socket hook wiring, URL param), `e2e/tests/terminal-compression.spec.ts`.
The only commit created is `6a5706a` (the 0.28 bump), as instructed.

IMPL COMPLETE

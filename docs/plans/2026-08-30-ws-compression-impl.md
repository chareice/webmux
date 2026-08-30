# Implement: end-to-end terminal output compression (deflate-raw-v1)

Branch `perf-ws-compression` (this worktree). Prerequisite research with
measurements and evidence: `docs/plans/2026-08-30-permessage-deflate-REPORT.md`
— read it first. Summary: real permessage-deflate is unavailable in our stack
(tungstenite has no codec); we implement **in-protocol raw-deflate** on terminal
output, per attach stream, end-to-end machine→browser. Measured 20-30x on
realistic ANSI output at ~365 MB/s/core.

The tokio-tungstenite 0.26→0.28 workspace bump (root `Cargo.toml` +
`Cargo.lock`) is already applied on this branch and compiles clean — keep it
as its own commit.

## Design (settled — do not redesign)

**Compression is end-to-end per attach.** The machine compresses an attach's
output stream; the hub relays the payload bytes verbatim (its zero-copy
routing/merging is payload-agnostic); the browser inflates. The hub NEVER
compresses or decompresses.

**Direction:** terminal output only (machine→browser). Input/keystrokes stay
uncompressed (latency direction, tiny messages). CLI attaches stay
uncompressed (no negotiation → no compression).

**Codec:** raw DEFLATE (no zlib header), window bits 15, level 6, context
takeover across messages (one long-lived stream per attach), and
`FlushCompress::Sync` at every message boundary with the trailing
`00 00 ff ff` kept ON the wire (do NOT strip it — we are not RFC 7692 framing;
keeping it lets the browser inflater consume message-concatenations
naturally). Use flate2 with the same backend the research probe validated
(`zlib-rs` backend needed for `new_with_window_bits`; if window-bits control
turns out unnecessary because 15 is the default, plain default backend is
fine — verify and note which you used). Because chunks from one attach are
produced by ONE compressor in order, hub- and browser-side merging of
consecutive chunks (both send loops merge) remains valid: the browser feeds
every arriving binary payload into one streaming inflater.

**Negotiation (version-skew safe in both directions; desktop ships its own
frontend bundle, so browser and hub versions DO skew):**

1. Machine capability: machine's hello/auth message to the hub gains an
   optional capability list or bool (serde `#[serde(default)]` so old hubs
   ignore it and old machines deserialize fine). Hub records it per machine.
2. Browser request: terminal WS URL gains query param `compress=deflate-raw-v1`
   (alongside existing `token`/`device_id`). Gated by an escape hatch:
   `localStorage "webmux:compress" === "off"` → don't request. Old hub ignores
   the param → never acks → browser stays uncompressed.
3. Hub decision: on terminal WS open, if the browser requested it AND the
   machine declared the capability, the hub (a) sends the browser a JSON text
   message ack — new `ServerMessage::CompressionEnabled { algo:
   "deflate-raw-v1" }` — **before any output byte can reach that socket**
   (send it before OpenAttach is dispatched to the machine, through the same
   ordered path as output, so no binary frame can precede it), and (b) sets a
   new `compress: bool` field (serde default false) on
   `HubToMachine::OpenAttach`.
4. Browser: only starts inflating after receiving the ack; without ack, all
   binary frames are raw PTY bytes exactly as today. Old machine (no cap) →
   hub never acks → uncompressed. Old hub → no ack → uncompressed. New hub +
   old browser → no query param → uncompressed.

**Machine side:** per-attach compressor created at OpenAttach when
`compress: true`, dropped at CloseAttach. Compress in the machine's existing
send loop AFTER its per-attach chunk merging, at message boundary (one sync
flush per outgoing WS message). The `refresh_attach` full-redraw path goes
through the same stream (it is just more output — no special casing).

**Browser side:** use `fflate`'s streaming `Inflate` (synchronous `push`,
raw deflate) — NOT `DecompressionStream` (async transform adds scheduling
latency to the keystroke-echo path). Add `fflate` (exact-pin, it is ~8 kB) to
`packages/app`. Wire it in `useTerminalLiveSocket.ts`: when the
CompressionEnabled ack has been seen, binary payloads pass through the
inflater and its output chunks feed the existing `enqueueOutput` path
(preserving the immediate-first-write behavior). An inflate error is
unrecoverable for the stream: log once and close the socket so the existing
reconnect path re-attaches (fresh context, and renegotiation may land
uncompressed).

**Security note (comment in code, from the research):** compressed streams
mixing secrets with attacker-influenced bytes are a CRIME-class oracle;
webmux is single-tenant per user today. If a shared-session/multi-tenant mode
ever appears, compression must be disabled there. Put this note where the
capability is negotiated in the hub.

## Where things live (verified starting points)

- Hub terminal WS: `crates/hub/src/ws.rs` `terminal_ws_handler` /
  `handle_terminal_ws` (query params already parsed there; the outbound
  send_task merges chunks — payload-agnostic, should need no change).
- Hub machine registry/manager: wherever the machine hello is processed
  (grep `authenticate_machine` in `crates/hub/src/ws.rs` and the manager) —
  store the capability next to existing per-machine state.
- Protocol types: `crates/protocol` (`HubToMachine`, `ServerMessage`,
  machine hello). All new fields `#[serde(default)]` / optional so old peers
  interop — add serde round-trip tests proving old-format messages still
  deserialize.
- Machine attach + send loop: `crates/machine/src/` (grep `OpenAttach`,
  `recv_many`). PR #288 added the merge loop — compress after merge.
- Browser: `packages/app/components/useTerminalLiveSocket.ts` (binary path +
  where ServerMessage JSON frames are handled), WS URL construction (grep
  `/ws/terminal/` in packages/app).

## Tests / verification (run all; fix what you break)

1. Rust codec round-trip unit test: compress N messages with sync flush,
   inflate the concatenation incrementally, assert byte-identical output —
   including chunks split at arbitrary boundaries (merging simulation).
2. Serde compat tests: OpenAttach without `compress`, machine hello without
   the capability field, both deserialize (old peer simulation).
3. `cargo test --workspace`, `cargo check --workspace --all-targets`.
4. Frontend: vitest for the inflater wiring if reasonably isolable;
   `pnpm test`, `pnpm typecheck`, `pnpm build` all green.
5. **Do NOT run the docker e2e stack — it is reserved by another task right
   now.** Instead ensure the change is e2e-able: compression must be ON by
   default in the e2e environment (it exercises hub+machine+web together), so
   the entire existing suite becomes a compression regression test the moment
   it runs. Write (but do not run) one new spec
   `e2e/tests/terminal-compression.spec.ts`: assert
   the CompressionEnabled ack arrives (expose a flag, e.g.
   `window.__webmuxCompression[terminalId] = true`, mirroring the
   `__webmuxEcho` pattern), then `seq 1 2000` and assert the buffer shows the
   tail lines correctly (inflated stream integrity under burst).

## Constraints

- Match surrounding code style; comments state constraints, not narration.
- No refactors beyond the spec. Keep the 0.28 bump commit separate; otherwise
  do not commit — leave changes for review.
- Write progress + results incrementally to
  `docs/plans/2026-08-30-ws-compression-impl-REPORT.md`; append
  `IMPL COMPLETE` when fully done.

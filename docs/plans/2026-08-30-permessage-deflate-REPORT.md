# permessage-deflate feasibility for webmux — RESEARCH REPORT

- Date: 2026-08-30
- Branch: `perf-ws-compression` (worktree `perf-input-scroll`)
- Status: IN PROGRESS (findings appended incrementally)

Vendored crate sources referenced below live under
`$CARGO_HOME/registry/src/index.crates.io-1949cf8c6b5b557f/` — abbreviated
`$REG/` in this report.

Current workspace state: root `Cargo.toml:19` pins
`tokio-tungstenite = { version = "0.26", features = ["rustls-tls-webpki-roots"] }`;
axum `0.8` with `ws` feature (`Cargo.toml:14`). Cargo.lock contains
tokio-tungstenite 0.26.2 (machine/cli legs) and tokio-tungstenite 0.28.0
(via axum 0.8.8) side by side.

---

### Finding: the premise is wrong — no published tungstenite ships permessage-deflate

Evidence:

- `tungstenite-0.28.0/src/` contains **no deflate/compression module** — file
  listing: buffer.rs, client.rs, error.rs, handshake/*, protocol/*, server.rs,
  stream.rs, tls.rs, util.rs. No `extensions/` or deflate code.
- `tungstenite-0.28.0/Cargo.toml` `[features]` (lines 54–82): only
  `__rustls-tls`, `default = ["handshake"]`, `handshake`, `native-tls*`,
  `rustls-tls-*`, `url`. **No `deflate`/`permessage-deflate` feature flag.**
- `grep -rni 'deflat|compress'` over tungstenite-0.28.0/src, tokio-tungstenite-0.28.0/src
  and tungstenite-0.26.2/src: only hits are in `handshake/headers.rs:61-69`,
  a *unit test* for case-insensitive parsing of the `Sec-WebSocket-Extensions`
  header (the header is parsed, never acted upon).
- tokio-tungstenite-0.28.0 `[features]` (lines 55–96): no deflate flag either.
- Upstream status: issue [snapview/tungstenite-rs#2](https://github.com/snapview/tungstenite-rs/issues/2)
  (open since 2017) is still open; PR
  [#426 "Add permessage-deflate support, again"](https://github.com/snapview/tungstenite-rs/pull/426)
  is **open, unmerged** (checked 2026-08-30 via GitHub API). Earlier attempts
  #144/#235/#328 were closed unmerged.
- Signal maintain their own fork (issue #2 comment 2025-11-14 by jrose-signal):
  <https://github.com/snapview/tungstenite-rs/compare/master...signalapp:tungstenite-rs:master>
  — "We had it on in production for a short time, then turned it back off due to
  issues unrelated to tungstenite... we don't have further plans to maintain it."
- Corroboration: other projects migrated away from tungstenite to get deflate —
  Vector replaced tokio-tungstenite with **yawc** for RFC 7692 support
  ([vectordotdev/vector#24654](https://github.com/vectordotdev/vector/pull/24654)).

**Corollary:** every sub-question that assumed "tungstenite 0.27+ has deflate"
(Q2 API, Q4 negotiation code path, Q5 tungstenite cost model) has the same
answer: *the feature does not exist in the released crate*. Answers below are
reframed around what actually exists and the realistic options.

---

## Q1 — Hub/browser leg: does axum 0.8.8 expose permessage-deflate?

**No.** Evidence:

- `axum-0.8.8/src/extract/ws.rs` — `WebSocketUpgrade` (line 133) wraps
  `tungstenite::protocol::WebSocketConfig` (imported line 114-120) and only
  exposes these knobs: `read_buffer_size` (157), `write_buffer_size` (171),
  `max_write_buffer_size` (187), `max_message_size` (193), `max_frame_size` (199),
  `accept_unmasked_frames` (205), protocol selection (210+). No compression API.
- `grep -i 'deflat|compress|permessage'` over axum-0.8.8 ws.rs: zero hits
  (the `.extensions` at lines 451/466 are *hyper request extensions*, unrelated).
- axum-0.8.9 (newer, also vendored) ws.rs: likewise zero hits. No axum feature
  flag or PR in any released 0.8.x enables it — impossible anyway, since the
  underlying tungstenite 0.28 has no codec (see above).
- axum's `ws` feature pulls `tokio-tungstenite 0.28.0` with **default features
  only** (`axum-0.8.8/Cargo.toml:264-266`, no features listed), and axum performs
  the upgrade handshake itself (sha1 + headers) then calls
  `WebSocketStream::from_raw_socket(upgraded, Role::Server, Some(config))`
  (ws.rs:342) — i.e. axum bypasses tungstenite's server handshake entirely, so
  even a tungstenite-side negotiation callback would not run under axum.

### Workarounds for the hub/browser leg

(a) **Manual upgrade route bypassing axum's extractor.** Possible but
insufficient alone: axum already does `from_raw_socket` — the missing piece is
a deflate *codec*, which stock tungstenite doesn't have. A manual route would
have to reimplement RFC 7692 frame transform (RSV1 bit, tail-strip
`00 00 ff ff`, context takeover) on top of `Message`/`Frame`. Sketch:

```rust
// pseudo-sketch — replaces WebSocketUpgrade
async fn ws_handler(req: Request) -> Response {
    // 1. validate headers, compute Sec-WebSocket-Accept (axum ws.rs does this at :330-360)
    // 2. parse `Sec-WebSocket-Extensions` offer; if it contains permessage-deflate,
    //    respond with `Sec-WebSocket-Extensions: permessage-deflate; ...params`
    // 3. hyper::upgrade::on(req) -> from_raw_socket(upgraded, Role::Server, cfg)
    // 4. wrap the WebSocketStream in a codec layer that deflate-compresses each
    //    outbound binary/text message, sets RSV1 on the first frame, strips the
    //    4-byte sync-flush tail; and inflates inbound messages with RSV1 set.
}
```
This means maintaining an RFC 7692 implementation ourselves (~300-500 lines +
interop risk). Highest-control, highest-maintenance option.

(b) **Swap the WS stack for one that has deflate**: `yawc` (what Vector did) or
`fastwebsockets` (deno, Cloudflare) on the hub↔browser leg; both integrate with
hyper/axum via manual upgrade. For machine→hub / cli→hub legs, swap
tokio-tungstenite client likewise.

(c) **In-protocol compression** (no RFC 7692): hub deflate-compresses the
binary payload before sending; browser inflates in JS with `fflate` (~8 kB
gzipped). Machine/cli legs use flate2 directly. No WS-stack change at all;
works over axum's existing extractor today. Costs: browser-side JS inflate
(cheap, native-speed wasm/js), no compression of small control frames
(negligible), and we must gate it with a protocol capability bit.

(d) **Signal's tungstenite fork** as a `[patch]`: battle-tested briefly at
Signal, explicitly unmaintained going forward; also still requires a manual
upgrade route because axum bypasses tungstenite's handshake (see above) — the
fork's negotiation happens in `accept_hdr`, which axum never calls.

## Q2 — Machine leg: client-side deflate API in tokio-tungstenite 0.28

**There is none.** `connect_async` / `connect_async_with_config` take
`tungstenite::protocol::WebSocketConfig`, which in 0.28.0
(`protocol/mod.rs`) contains only buffer/size/timeout/masking fields — no
extension or compression fields. The client handshake (`client.rs`,
`generate_request`) never emits `Sec-WebSocket-Extensions`. So the machine leg
gets compression only via option (b)/(c)/(d) above.

---

## Q3 — Workspace bump 0.26 → 0.28

Changed root `Cargo.toml:19` to
`tokio-tungstenite = { version = "0.28", features = ["rustls-tls-webpki-roots"] }`
(kept the feature set identical), ran `cargo check --workspace --all-targets`.

**Result: zero compile breakage.** `Finished dev profile in 4.98s`, no
tungstenite-related errors or warnings in `crates/{cli,hub,machine,protocol}`.

Why it was painless: the big API migration (Utf8Bytes for `Message::Text`,
`Bytes` for `Message::Binary`) already happened in 0.26, and this codebase was
written against it — all sites use `msg.into()` / `bytes.to_vec()` /
`&text` (Deref<Target=str>), e.g. `crates/hub/src/ws.rs:210,237,253`,
`crates/cli/src/attach.rs:171,346`, `crates/machine/src/hub_conn.rs`. 0.28 is
largely a dependency refresh (hyper 1, http 1 alignment) over 0.26.

Side benefit: `Cargo.lock` now has a single `tungstenite 0.28.0` /
`tokio-tungstenite 0.28.0` (previously 0.26.2 + 0.28.0 coexisted; lock diff
-39/+10 lines, dropping the duplicate tree).

**Changes made (recorded, not committed):**
1. root `Cargo.toml`: tokio-tungstenite `0.26` → `0.28` (1 line).
2. `Cargo.lock` regenerated by cargo. No source fixes were needed.

Note: this bump is worth doing regardless of the compression decision (single
tungstenite in the tree), but by itself it buys **no** deflate capability.

Worktree is left compiling: `cargo check --workspace --all-targets` green.

---

## Q4 — Browser offer handling

- **Server accept path (tungstenite 0.28):** `handshake/server.rs` and
  `server.rs` contain **zero** references to `Sec-WebSocket-Extensions` (grep:
  only `handshake/client.rs` mentions it). The server handshake neither parses
  nor echoes the header — a browser's `permessage-deflate` offer is silently
  ignored, which is spec-legal (server MAY decline any extension).
- The only extension-aware code is a header-parsing unit test,
  `handshake/headers.rs:58-71`, proving `Sec-WebSocket-Extensions` values are
  retrievable case-insensitively via `HeaderMap::get_all` — i.e. the plumbing to
  *read* an offer exists, nothing acts on it.
- **Client caveat (machine/cli leg):** the RFC 6455 required check "fail the
  connection if the server claims an extension the client didn't request" is an
  unimplemented `// TODO` at `handshake/client.rs:263-268`. Consequence: if a
  hub ever negotiates deflate with a stock-tungstenite client that didn't offer
  it, the client will NOT error — it will silently deliver still-compressed
  bytes to the application. Negotiation must therefore be strictly
  client-offer-driven: never enable deflate unless the client's offer contained
  it.
- **`client_max_window_bits` caveat:** Chrome/Firefox send
  `Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits`
  **without a value** (per RFC 7692 §7.1.2.2 this is an offer meaning "I can
  accept any window bits you dictate"). Any implementation we adopt must treat
  a valueless `client_max_window_bits` as valid and respond with a concrete
  value (or omit the parameter); rejecting valueless params would break every
  mainstream browser. (Relevant to options (a)/(b)/(d), moot for stock
  tungstenite which ignores the header entirely.)

## Q5 — Cost model (memory / CPU / latency)

Since tungstenite has no deflate implementation, the cost model comes from the
DEFLATE layer any option would use (zlib / miniz_oxide via flate2 1.1.9,
vendored):

- **Memory per connection (window_bits=15, i.e. 32 KiB window, zlib defaults):**
  compressor ≈ 256 KiB, decompressor ≈ 40 KiB — ≈ **300 KiB per direction pair
  per connection** with context takeover retained. Reducing
  `server_max_window_bits`/`client_max_window_bits` to 12 cuts the window to
  4 KiB and compressor memory to roughly ~40 KiB (window+tables scale with
  2^bits). RFC 7692 lets the server dictate both values in the response.
- **Context takeover:** keeping the LZ77 dictionary across messages is what gets
  the big ratios on repetitive terminal output. `no_context_takeover` (reset per
  message) keeps the same memory while active but lets contexts be
  pooled/reused across connections, at a significant ratio cost (measured in Q6).
- **Latency (the NO-GO check):** RFC 7692 §7.2.1 defines message end as a
  deflate `Z_SYNC_FLUSH` with the trailing `00 00 ff ff` stripped. Compression
  is therefore **per-message, flush-at-end by construction** — no cross-message
  buffering is possible in a conforming implementation. Keystroke echo latency
  is unaffected beyond zlib's own encode time (µs for small messages). flate2
  equivalent: `Compress::compress(..., FlushCompress::Sync)` per message end.
  The risk called out in the task (a compressor buffering across messages)
  does not materialize for any RFC-conforming stack; it would only appear in a
  hand-rolled streaming wrapper that forgets the sync flush.
- **CPU:** deflate level 6 on already-redundant terminal output is cheap
  (miniz_oxide ~ tens of MB/s+/core worst case, typically hundreds); the hot
  path concern is the hub with N browser connections, not the machine.

### Recommended settings (assuming an RFC 7692-capable stack)

| Leg | Direction | Settings |
|---|---|---|
| hub (10–100 browser conns) | hub→browser | level 6, `server_max_window_bits=12`, context takeover ON; pool compressors if conn count grows past ~100 |
| hub | browser→hub (keystrokes) | accept client's offer as-is (`client_max_window_bits` dictated as 12) |
| machine (1 conn) | machine→hub | level 6, window 15, context takeover ON (single conn — memory is free) |

At 100 browser connections with 4 KiB windows: ≈ 100 × ~80 KiB (both
directions) ≈ 8 MiB — acceptable on the hub.

---

## Q6 — Experiment: measured compression of a realistic ANSI stream

Throwaway probe (deleted after measuring): `perf-probe/` — flate2 1.1.10 with
the `zlib-rs` backend (needed for `Compress::new_with_window_bits`, gated
behind flate2's `any_zlib` feature, `flate2-1.1.10/src/mem.rs:216-218` —
miniz_oxide does not expose window-bits control). Raw DEFLATE (no zlib
wrapper), `FlushCompress::Sync` per message, 4-byte `00 00 ff ff` tail
stripped — i.e. exactly RFC 7692 wire semantics.

Sample: 512,454 bytes of generated terminal output mixing colored
`ls -la`-style rows, repeated status lines, and tmux-style `H`+`2J`
full-screen redraws.

Results (level 6, single thread):

| msg size | wbits=15 + takeover | wbits=12 + takeover | wbits=15, NO takeover |
|---|---|---|---|
| 1 KiB  | 26,268 B — **19.5x** | 63,835 B — 8.0x  | 102,844 B — 5.0x |
| 16 KiB | 17,544 B — **29.2x** | 52,366 B — 9.8x  | 33,942 B — 15.1x |
| 64 KiB | 16,856 B — **30.4x** | 50,645 B — 10.1x | 21,067 B — 24.3x |

Throughput: **~365 MB/s/core** at wbits=15, ~294 MB/s at wbits=12 (zlib-rs,
level 6, 100×512 KiB passes). CPU is a non-issue: even 100 MB/s of aggregate
terminal output would cost <0.3 core.

Takeaways:
- The "5–10x" expectation is beaten: **~20–30x** with context takeover at the
  default 32 KiB window, because terminal redraws repeat multi-KiB blocks.
- Shrinking to `window_bits=12` (the memory-saving knob) **costs 2–3x ratio**
  on this workload — the repeated blocks are larger than 4 KiB, so the small
  window can't reference them. Trade-off matters on the hub with many
  connections; it's why compressing once and fanning out (below) is attractive.
- `no_context_takeover` with small (1 KiB) messages is the worst case (5x) —
  still worthwhile but clearly inferior; prefer takeover + memory budgeting.

## Alternatives assessed

| Option | What it is | Verdict |
|---|---|---|
| (a) Manual axum upgrade + hand-rolled RFC 7692 codec on stock tungstenite | ~300-500 lines of RSV1/tail-strip/context logic we maintain | NO-GO: interop risk, maintenance, duplicates what libraries already do |
| (b) Swap WS stack: `yawc` or `fastwebsockets` | Both ship RFC 7692; Vector migrated tokio-tungstenite→yawc for exactly this | GO technically, but replaces the WS stack on all 3 legs + manual axum upgrade route; largest diff |
| (c) **In-protocol deflate** (application-level, flate2/zlib-rs; browser uses `fflate`) | No WS-stack change; compress binary payloads before `Message::Binary` | **GO — recommended.** See below. |
| (d) Signal's tungstenite fork via `[patch]` | Real RFC 7692, briefly production-tested at Signal | NO-GO: explicitly unmaintained; still needs manual upgrade route (axum bypasses tungstenite's handshake) |

Extra advantage of (c) specific to webmux: hub→browser is a *fan-out* of the
same machine output to N browsers. In-protocol compression lets the machine (or
hub) compress **once** and relay identical bytes to all browsers — O(1)
compression CPU and zero per-connection deflate state on the hub, vs O(N)
contexts under RFC 7692. The browser inflates with `fflate` (~8 kB gz).

## GO / NO-GO per leg

- **machine → hub**: **GO** via (c). Both ends are our Rust code; flate2 +
  sync-flush-per-message; context takeover on (single connection, memory free).
- **hub → browser**: **GO** via (c) with capability negotiation (below).
  RFC 7692 proper is NO-GO on axum 0.8.8 (no API, no codec underneath).
- **cli → hub**: **GO** via (c), but lowest value (control messages, low
  volume) — do it only if it falls out of the shared codec for free.
- **browser → hub (keystrokes)**: **don't compress.** Tiny messages; per-message
  deflate overhead (~5-11 B flush block) can exceed savings, and latency is the
  only thing that matters on this direction.

## Minimal change list for the follow-up implementation spec

1. Keep the tokio-tungstenite 0.26→0.28 workspace bump (done on this branch,
   clean check, dedups the lockfile). Independent of compression.
2. `crates/protocol`: add a capability bit, e.g. `compression: deflate-raw-v1`
   in the connect handshake (browser leg: negotiate via `Sec-WebSocket-Protocol`
   subprotocol token, since browsers can't set arbitrary WS headers; axum's
   extractor already supports subprotocol selection).
3. Shared codec module (new small crate or `crates/protocol` feature):
   `DeflateCtx` wrapping flate2/zlib-rs `Compress`/`Decompress`, raw deflate,
   window 15, `FlushCompress::Sync` per message, strip/restore the 4-byte tail
   on the wire so the codec is byte-identical to RFC 7692 framing (keeps the
   door open to real permessage-deflate later). One flag byte or a new
   `CompressedOutput` protocol message marks compressed payloads.
4. `crates/machine`: compress terminal-output batches before send (single
   context, takeover on).
5. `crates/hub`: relay compressed payloads verbatim to subscribed browsers when
   all parties negotiated the capability; decompress only for consumers that
   didn't (existing cli clients). Fall back to passthrough when uncompressed.
6. Browser (`packages/app` or `packages/shared`): `fflate` `Inflate` (streaming,
   raw) on flagged binary messages.
7. Tests: round-trip codec test in Rust; e2e via existing `pnpm e2e:test` path
   with compression negotiated on.

## Risks / caveats

- **Latency**: RFC-conforming per-message sync flush (what we measured) means
  no cross-message buffering; keystroke echo path stays uncompressed anyway.
  Verified: sync flush emits the block immediately; only the 4-byte tail is
  stripped. A buffering-across-messages design would be a NO-GO and is not
  proposed.
- **CPU**: negligible at measured ~300-365 MB/s/core, especially with
  compress-once/fan-out.
- **Memory**: in-protocol mode needs one compressor on each machine (≈256 KiB)
  and one decompressor per browser/CLI consumer (≈40 KiB, in JS for browsers).
  No per-connection deflate state on the hub.
- **Compression oracle (CRIME-style)**: compressed terminal output mixes
  potentially secret content with attacker-influenced bytes; webmux sessions
  are same-user/single-tenant so the practical risk is low, but note it for
  any future multi-tenant/shared-session mode — disable compression there.
- **Negotiation discipline**: because stock tungstenite clients don't validate
  server-claimed extensions (the `// TODO` at
  `tungstenite-0.28.0/src/handshake/client.rs:268`), enable compression only on
  explicit client opt-in; a mismatched peer would otherwise receive compressed
  bytes with no error.
- **Valueless `client_max_window_bits`**: if a future migration moves to real
  RFC 7692 (option b), remember browsers send the parameter without a value —
  any hand-rolled parser must accept that.

Probe crate `perf-probe/` was deleted after measurement. Worktree state:
`cargo check --workspace --all-targets` green; uncommitted changes are limited
to root `Cargo.toml` (0.28 bump), `Cargo.lock`, and this report.

REPORT-COMPLETE

# webmux CLI — agent-to-agent session control

**Status:** implementation spec (2026-08-03)
**Follow-up:** batch screen capture (`read --all`) added by [2026-08-04-cli-read-all.md](2026-08-04-cli-read-all.md).
**Follow-up:** agent-consumable output (sanitize, `--lines` parity, `send` paste timing, `--all` activity fields) added by [2026-08-05-cli-agent-output.md](2026-08-05-cli-agent-output.md).
**Goal:** a single static Rust binary `webmux` that lets external agents (Claude Code / Codex / Grok / Kimi headless) and humans list, open, read, write to, and wait on terminals on any machine registered to a webmux hub — "remote `tmux send-keys` + `capture-pane` through the hub".

## Why CLI (not MCP first)

Every controlling agent can run shell commands; MCP client support is uneven. CLI is the lowest common denominator, scriptable by humans too. An MCP wrapper can come later as a thin subcommand over the same core.

## Verified hub facts (do NOT re-derive; cite when unsure)

- REST base: `https://<host>/api/...`, auth `Authorization: Bearer <token>` where token is an API token (`wmx_` prefix) or JWT. Verified by `auth::verify_bearer_token` (`crates/hub/src/auth.rs:147`).
- Terminal WS: `wss://<host>/ws/terminal/{machine_id}/{terminal_id}?token=<token>&device_id=<id>` (`crates/hub/src/ws.rs:131`). Without a valid token → 401 (unless hub dev_mode).
  - Server→client: **binary frames** = raw PTY output bytes.
  - Client→server: **JSON text frames**, e.g. `{"type":"input","data":"..."}`, `{"type":"resize","cols":N,"rows":N}` (see `ClientMessage` at `crates/hub/src/ws.rs:47`).
  - Hub opens the machine-side `tmux attach` at the terminal's stored dimensions itself (`ws.rs:180`) — the client does NOT pass size on the WS.
  - Sending `input` as an authenticated non-controller claims control (LWW, `ws.rs` test `authenticated_input_from_a_non_controller_claims_control`). `resize` does not claim control. A client that never sends input is a read-only watcher.
- Every attach is an independent `tmux attach-session` (`crates/machine/src/attach.rs:168`); on connect tmux repaints the full screen, so a client-side terminal emulator fed with the binary stream reconstructs the current screen.
- tmux runs with `window-size manual` (`crates/machine/src/pty.rs:544`): attaching clients do NOT resize other clients' views.
- `TerminalInfo` (in `crates/protocol/src/lib.rs`): `id, machine_id, title, cwd, workspace_group_id?, cols, rows, reachable`.
- `CreateTerminalRequest` (`crates/hub/src/routes/terminals.rs:19`): `{ cwd, startup_command?, cols?, rows? }` → `POST /api/machines/{machine_id}/terminals` returns the created terminal (TerminalInfo JSON).
- Other REST: `GET /api/machines`, `GET /api/terminals`, `GET /api/machines/{id}/terminals`, `DELETE /api/machines/{id}/terminals/{tid}`, `GET /api/machines/{id}/workspace-groups`, `PUT /api/machines/{id}/terminals/{tid}/workspace-group` (body `{ "workspace_group_id": <id-or-null> }` — verify exact shape in routes/terminals.rs before use).
- **Control lease gates mutating REST** (found the hard way — first `open` 403'd): `create_terminal` requires the request body's `device_id` to equal the current controller device (`control_action_allowed`, `routes/terminals.rs:77,194`); `destroy_terminal` takes `device_id` as a **query param** with the same check (`terminals.rs:801-806`). Claim via `POST /api/mode/control` `{machine_id, device_id}` (`routes/mode.rs`), last-writer-wins, never released by the CLI. Workspace-group and layout endpoints are NOT gated. WS input claims control implicitly, so `send`/`key` need no REST claim; `read`/`wait` never claim (pure watchers).
  - CLI device id: stable per host, `cli-<hostname>` (sanitized `[a-zA-Z0-9-]`, fallback `cli`), claimed immediately before each mutating call (`open`, `kill`).

## Deliverable

New crate `crates/cli` (auto-joins workspace via `members = ["crates/*"]`):

- package name `tc-cli`, binary name `webmux` (`[[bin]] name = "webmux"`)
- deps: clap (derive), tokio, reqwest (workspace, rustls), tokio-tungstenite (workspace, rustls), vt100 (workspace), serde/serde_json, tc-protocol (path), dirs (workspace), thiserror, regex, toml, futures (workspace). Add new external deps to the crate's Cargo.toml (pin reasonable versions); reuse workspace deps where they exist.
- Rust 2021, no `unsafe`.

### Config resolution (precedence: flag > env > config file)

- `--url` / `WEBMUX_URL` / `url` in `~/.config/webmux/config.toml` (dirs crate; 0600 perms when written)
- `--token` / `WEBMUX_TOKEN` / `token` in same file
- Missing either → exit 2 with a message telling the user to create an API token in the web UI and set `WEBMUX_TOKEN`.
- WS URL derived from the hub URL: `https:`→`wss:`, `http:`→`ws:`, trailing slashes trimmed.

### Commands

```
webmux machines [--json]
webmux ls [--machine <id>] [--json]
webmux open <machine> --cwd <dir> [--cmd <shell command>] [--group <name>] [--cols N --rows N] [--json]
webmux read <term> [--lines N] [--json] [--quiet-ms 500] [--timeout 10s]
webmux send <term> <text...> [--no-enter]
webmux key <term> <KEY> [KEY...]
webmux wait <term> [--pattern <regex>] [--silence <ms>] [--timeout <sec>]
webmux kill <term> [--yes]
```

- `<machine>` / `<term>`: unique id-prefix resolution against live list (exact match wins; ambiguous prefix → exit 2 listing candidates). `ls` prints ids as first-8 short forms plus full id in `--json`.
- Exit codes: 0 ok / wait matched; 1 wait timeout; 2 usage/config/network/protocol error. Human output on stdout, diagnostics on stderr. `--json` = machine-readable on stdout.

### Command semantics

- **machines / ls**: REST GET, print table (id, name/host, terminal count, reachability) / (short id, title, group, cwd, fg size, reachable). `--json` passes through the REST JSON (use tc-protocol types where they match).
- **open**: resolve machine, `POST .../terminals` with `{cwd, startup_command: cmd?, cols?, rows?}`. `--group NAME`: resolve against `GET .../workspace-groups` by name (error if missing; do NOT auto-create in v1), then PUT workspace-group assignment. Print created id (full JSON with `--json`).
- **read**: resolve terminal, fetch its `cols/rows` from `GET /api/terminals` (fallback 120x36), attach WS as watcher (device_id `cli-read-<pid>`; NEVER send input/resize), feed every binary frame into a `vt100::Parser` sized cols×rows. Done when no bytes arrive for `--quiet-ms` after the first byte, or `--timeout` total, or WS closed. Then print `screen.contents()` with trailing blank lines trimmed (`--lines N` = last N lines after trim). `--json`: `{"id","cols","rows","screen"}`.
- **send**: resolve, attach (device_id `cli-send-<pid>`), send one `{"type":"input","data": text}` frame (text args joined with single spaces; append `\r` unless `--no-enter`), flush, brief 200 ms grace, close. Note in --help: "claims control (last-writer-wins)".
- **key**: like send but maps keyspecs to byte sequences, each key sent as its own input frame in order. Keyspecs (case-insensitive): `Enter`(\r), `Esc`(\x1b), `Tab`(\t), `BTab`(\x1b[Z), `Space`( ), `Up|Down|Right|Left`(\x1b[A/B/C/D), `Home|End`(\x1b[H/F), `PgUp|PgDn`(\x1b[5~/6~), `Del`(\x1b[3~), `Backspace`(\x7f), `F1..F12` (xterm sequences), `C-<letter>` (0x01..0x1a, e.g. `C-c`=\x03), `C-[`=\x1b. Unknown keyspec → exit 2 listing valid forms.
- **wait**: requires at least one of `--pattern` / `--silence`. Attach like read; continuously feed vt100. `--pattern`: after each output burst, test regex against current `screen.contents()` → match = exit 0. `--silence MS`: exit 0 when no bytes for MS (after the first byte). `--timeout SEC` (default 60, 0 = forever) → exit 1. WS closed / terminal gone / error → exit 2.
- **kill**: resolve, confirm unless `--yes` or non-tty, DELETE, print result.

### Engineering requirements

- Structure: `src/main.rs` (clap), `src/config.rs`, `src/client.rs` (REST), `src/attach.rs` (WS + vt100 screen), `src/keys.rs`, `src/resolve.rs` (id-prefix), `src/commands/*.rs`. Keep functions small; thiserror error types; no unwrap/expect outside tests (except truly infallible).
- Logging: `-v` flag → tracing-subscriber stderr at debug; default silent.
- Timeouts everywhere (connect 10s default); clean errors on 401 ("token invalid/expired — create a new API token in the web UI"), 404 ("terminal not found"), WS close mid-read.
- Unit tests: keyspec parsing (incl. invalid), id-prefix resolution (exact/unique/ambiguous/none), trailing-blank-line trimming + `--lines` slicing, config precedence, ws-url derivation. No network in unit tests (pure functions); factor logic to allow that.
- `cargo fmt`, `cargo clippy -p tc-cli -- -D warnings` clean, `cargo test -p tc-cli` green, `cargo check --workspace` green (CI runs the last one).

### Explicit non-goals (v1)

- No deep scrollback (`read` sees the live screen only; scrollback accumulation across a long attach happens naturally but is not exposed as a flag).
- No `tail -f`, no MCP subcommand, no token creation/login flow, no group creation.
- No changes to hub/machine/protocol crates. If something seems missing on the server, STOP and report instead of patching the server.

## Manual e2e recipe (for the reviewer, not the implementer)

Run hub with `WEBMUX_DEV_MODE=true`, register a machine, create an API token via `/api/auth/dev` + `POST /api/auth/api-tokens`, then: `open --cmd bash` → `send "echo hi"` → `wait --pattern hi` → `read` → `kill`.

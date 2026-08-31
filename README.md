# offdesk

Web-based control plane for terminals and AI coding agents. Run shells, editors, and TUI agents (Claude Code, Codex, Grok, …) on any machine, reach them from any browser or phone — and drive them programmatically from other agents via the `offdesk` CLI.

## Architecture

- `crates/hub` — Rust server (Axum + WebSocket + SQLite). Serves the web UI as an SPA, brokers terminal I/O between browsers/CLI and machines, owns auth (GitHub/Google OAuth + `odk_` API tokens) and the per-machine control lease (single controller, last-writer-wins).
- `crates/machine` — Rust machine agent (`offdesk-node`). Registers with a hub, hosts terminals as tmux sessions (one `tmux attach` per client — multi-client views, no shared scroll state), reports stats.
- `crates/cli` — Rust CLI (`offdesk`). Remote `tmux send-keys` + `capture-pane` through the hub; the agent-to-agent interface (see below).
- `packages/app` — the only frontend: Expo Router + React Native Web + xterm.js 6. Built with `expo export --platform web`, served by the hub, wrapped by Tauri for desktop (`packages/desktop`) and Android.
- `crates/protocol` (`offdesk-protocol`) — shared wire types between hub, machine, and CLI.

## The `offdesk` CLI (for humans and agents)

The CLI lets anything that can run a shell command — a human, a script, or another AI agent — list, open, read, write to, and wait on terminals on any machine registered to a hub.

### Install & authenticate

```bash
cargo build --release -p offdesk-cli          # binary: target/release/offdesk
```

Create an API token in the web UI (**⌃B k → Settings → API Tokens → Create**), then either:

```bash
# ~/.config/offdesk/config.toml  (chmod 600)
url   = "https://your-hub.example.com"
token = "odk_..."
```

or export `OFFDESK_URL` + `OFFDESK_TOKEN` (flags `--url/--token` override both).

### Commands

```
offdesk machines [--all] [--json]               # list machines (default: online; --all includes offline)
offdesk machines rm <id|name> [--yes]           # forget a registered machine
offdesk ls [--machine <id>] [--json]            # list terminals: id, title, group, cwd, size, reachable
offdesk open <machine> --cwd <dir> [--cmd <shell command>] [--group <name>] [--json]
offdesk read <term> [--lines N] [--json]        # capture the current screen as text
offdesk read --all [--machine <id>] [--lines N] [--json] [--concurrency N] [--include-unreachable]
                                               # batch-capture every terminal's screen in one call
offdesk send <term> <text...> [--no-enter]      # type text (Enter appended by default)
offdesk key  <term> <KEY>...                    # Enter Esc Tab BTab Up Down Left Right C-c C-d F1-F12 ...
offdesk wait <term> [--pattern <regex>] [--silence <ms>] [--timeout <sec>]
offdesk kill <term> [--yes]
```

- Machines and terminals are addressed by **id prefix** (first column of `ls`); ambiguous prefixes list candidates.
- Exit codes: `0` success / wait condition met · `1` wait timed out · `2` usage/config/network error. Everything is scriptable; `--json` for machine consumption.
- `--lines N` means "the last N rendered lines of the current screen" (after trailing blank lines are trimmed) in both text and JSON mode; JSON also reports `lines_total` (pre-slice count) and `truncated`.
- All printed/serialized output is sanitized (control bytes stripped, `\n`/`\t` and Unicode kept) — safe to pipe to `jq`/`file`.
- `send` types the text, then sends Enter as a **separate delayed frame** (delay scales with line count, capped at 800 ms) so TUI apps that treat multi-line bursts as pastes still submit. `--no-enter` sends the text frame only (pure paste).
- `read --all --json` lists **reachable terminals only** by default, with `skipped_unreachable_count` at the top level; `--include-unreachable` restores their `{"error":"unreachable"}` entries. Each captured entry carries `pane_title`, `title_source` (`osc`/`process`/`none`), `foreground_process` (`{has_foreground_process, process_name}`, null on lookup failure), `activity` (`active`/`quiet`/`idle`) and `idle_ms` — activity is observed during the capture window only. `cwd` is live (tmux `pane_current_path`, refreshed ~5s), not creation-time.

### Orchestrating an agent inside a terminal

```bash
T=$(offdesk open nas --cwd ~/projects/foo --cmd claude --json | jq -r .id)
offdesk send $T "fix the type errors in src/auth.ts; stop when tests pass"
offdesk wait $T --silence 5000 --timeout 600     # or --pattern '❯' to await a prompt
offdesk read $T --lines 80                        # collect the result
offdesk kill $T --yes
```

### Semantics you must know

1. **`send`/`key` claim control** (last-writer-wins). Other clients of the same account become view-only until a human reclaims. Read first if a human might be typing. The CLI claims the machine's control lease automatically for mutating calls (`open`, `kill`) with a stable `cli-<hostname>` device id.
2. **`read`/`wait` are pure watchers** — they never claim control and never disturb other clients (tmux runs `window-size manual`, so attaching doesn't resize anyone's view).
3. **`read` sees the current screen only** (reconstructed from tmux's attach repaint). For long output, have the session's agent write files and read those.
4. **Don't poll with repeated `read`** (~1 s attach per call) — hold a `wait` for the condition instead.
5. **For an overview of every terminal, use `read --all`** — do not loop N CLI processes over `read` (slow: N×TLS+attach; and consumers that don't drain stdout concurrently can deadlock on the pipe buffer).
6. `REACHABLE=no` terminals belong to offline machines and can't be attached. `read --all` skips them (one-line `skipped (unreachable)` row; omitted from JSON unless `--include-unreachable`) and reports the count on stderr and as `skipped_unreachable_count` in JSON.
7. **A token is remote code execution on every registered machine.** Mint one token per agent (name them in Settings) so you can revoke individually and see who was active via "last used".

## Development

```bash
# hub (serves API + the exported web build on :4317)
OFFDESK_DEV_MODE=true cargo run -p offdesk-hub

# machine agent (registers on first run)
offdesk-node register --hub-url http://127.0.0.1:4317 --token <register-token>
offdesk-node start

# web app (Expo dev server; proxy.mjs forwards /api and /ws to the hub)
pnpm install && pnpm --filter app dev:web
node proxy.mjs
```

`OFFDESK_DEV_MODE=true` enables `/api/auth/dev` for token-less local logins. See `AGENTS.md` for the E2E browser rules, and `docs/plans/` for design specs (notably `2026-08-03-offdesk-cli.md` for the CLI protocol details and `2026-08-03-api-tokens-ui.md`).

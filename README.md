# webmux

Web-based control plane for terminals and AI coding agents. Run shells, editors, and TUI agents (Claude Code, Codex, Grok, …) on any machine, reach them from any browser or phone — and drive them programmatically from other agents via the `webmux` CLI.

## Architecture

- `crates/hub` — Rust server (Axum + WebSocket + SQLite). Serves the web UI as an SPA, brokers terminal I/O between browsers/CLI and machines, owns auth (GitHub/Google OAuth + `wmx_` API tokens) and the per-machine control lease (single controller, last-writer-wins).
- `crates/machine` — Rust machine agent (`webmux-node`). Registers with a hub, hosts terminals as tmux sessions (one `tmux attach` per client — multi-client views, no shared scroll state), reports stats.
- `crates/cli` — Rust CLI (`webmux`). Remote `tmux send-keys` + `capture-pane` through the hub; the agent-to-agent interface (see below).
- `packages/app` — the only frontend: Expo Router + React Native Web + xterm.js 6. Built with `expo export --platform web`, served by the hub, wrapped by Tauri for desktop (`packages/desktop`) and Android.
- `crates/protocol` (`tc-protocol`) — shared wire types between hub, machine, and CLI.

## The `webmux` CLI (for humans and agents)

The CLI lets anything that can run a shell command — a human, a script, or another AI agent — list, open, read, write to, and wait on terminals on any machine registered to a hub.

### Install & authenticate

```bash
cargo build --release -p tc-cli          # binary: target/release/webmux
```

Create an API token in the web UI (**⌃B k → Settings → API Tokens → Create**), then either:

```bash
# ~/.config/webmux/config.toml  (chmod 600)
url   = "https://your-hub.example.com"
token = "wmx_..."
```

or export `WEBMUX_URL` + `WEBMUX_TOKEN` (flags `--url/--token` override both).

### Commands

```
webmux machines [--json]                       # list machines (online/offline)
webmux ls [--machine <id>] [--json]            # list terminals: id, title, group, cwd, size, reachable
webmux open <machine> --cwd <dir> [--cmd <shell command>] [--group <name>] [--json]
webmux read <term> [--lines N] [--json]        # capture the current screen as text
webmux send <term> <text...> [--no-enter]      # type text (Enter appended by default)
webmux key  <term> <KEY>...                    # Enter Esc Tab BTab Up Down Left Right C-c C-d F1-F12 ...
webmux wait <term> [--pattern <regex>] [--silence <ms>] [--timeout <sec>]
webmux kill <term> [--yes]
```

- Machines and terminals are addressed by **id prefix** (first column of `ls`); ambiguous prefixes list candidates.
- Exit codes: `0` success / wait condition met · `1` wait timed out · `2` usage/config/network error. Everything is scriptable; `--json` for machine consumption.

### Orchestrating an agent inside a terminal

```bash
T=$(webmux open nas --cwd ~/projects/foo --cmd claude --json | jq -r .id)
webmux send $T "fix the type errors in src/auth.ts; stop when tests pass"
webmux wait $T --silence 5000 --timeout 600     # or --pattern '❯' to await a prompt
webmux read $T --lines 80                        # collect the result
webmux kill $T --yes
```

### Semantics you must know

1. **`send`/`key` claim control** (last-writer-wins). Other clients of the same account become view-only until a human reclaims. Read first if a human might be typing. The CLI claims the machine's control lease automatically for mutating calls (`open`, `kill`) with a stable `cli-<hostname>` device id.
2. **`read`/`wait` are pure watchers** — they never claim control and never disturb other clients (tmux runs `window-size manual`, so attaching doesn't resize anyone's view).
3. **`read` sees the current screen only** (reconstructed from tmux's attach repaint). For long output, have the session's agent write files and read those.
4. **Don't poll with repeated `read`** (~1 s attach per call) — hold a `wait` for the condition instead.
5. `REACHABLE=no` terminals belong to offline machines and can't be attached.
6. **A token is remote code execution on every registered machine.** Mint one token per agent (name them in Settings) so you can revoke individually and see who was active via "last used".

## Development

```bash
# hub (serves API + the exported web build on :4317)
WEBMUX_DEV_MODE=true cargo run -p tc-hub

# machine agent (registers on first run)
webmux-node register --hub-url http://127.0.0.1:4317 --token <register-token>
webmux-node start

# web app (Expo dev server; proxy.mjs forwards /api and /ws to the hub)
pnpm install && pnpm --filter app dev:web
node proxy.mjs
```

`WEBMUX_DEV_MODE=true` enables `/api/auth/dev` for token-less local logins. See `AGENTS.md` for the E2E browser rules, and `docs/plans/` for design specs (notably `2026-08-03-webmux-cli.md` for the CLI protocol details and `2026-08-03-api-tokens-ui.md`).

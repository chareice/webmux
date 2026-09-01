# offdesk

Vibe code from your phone, on the terminal running at home.
One self-hosted hub, all your machines, any agent that runs in tmux.

<!-- TODO(ryan): record docs/media/hero.gif — see docs/media/README.md -->
![Claude Code running on a desk machine, with a phone attached to the same tmux session](docs/media/hero.gif)

- Runs anything that runs in a terminal: Claude Code, Codex, Grok, vim, htop.
  No agent-specific integration.
- One hub, any number of machines. Register a Mac, a NAS, a VPS — open them all
  from one URL.
- Your traffic goes through your hub. No third-party server in the path.
- `offdesk open nas --cwd ~/app --cmd claude` works from a script — or from
  another agent.
- Rust. The hub is one binary plus a SQLite file. The machine agent is one
  binary.

## Install

Three pieces. The hub is the only one that needs a URL other people can reach.

### Hub

Docker, on the machine that will hold the URL:

```bash
git clone https://github.com/zalify/offdesk && cd offdesk
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```

It listens on `127.0.0.1:4317` and keeps its SQLite file in the `offdesk-data`
volume. Set `JWT_SECRET` — the built-in default is the literal string
`dev-secret-change-me`, which is not a secret.

The hub signs you in with GitHub or Google OAuth. Which one you configure, and
what callback URL it needs, depends on how you reach the hub, so that part is
in the two setup guides below.

Or build it directly:

```bash
cargo build --release --bin offdesk-hub
./target/release/offdesk-hub --listen 0.0.0.0:4317
```

<!-- TODO(ryan): publish ghcr.io/zalify/offdesk-hub under the new name, then
     replace the clone-and-build above with a plain `docker run`. The
     container workflow builds it on push to main. -->

### Machine

On every machine you want to reach. tmux is required — the agent checks for it
at startup and exits if it is missing.

```bash
cargo build --release --bin offdesk-node
offdesk-node register --hub-url https://your-hub.example.com --token <token>
offdesk-node start
```

Get `<token>` from the hub's web UI. It is single-use and expires 24 hours
after it is issued.

To keep it running across reboots — a systemd user service on Linux, a launchd
agent on macOS:

```bash
offdesk-node service install
```

<!-- TODO(ryan): scripts/install.sh downloads offdesk-node-{linux,darwin}-{x64,arm64}
     from GitHub releases. No release carries those names yet — the last ones
     are webmux-node-*. Tag a v* release, then document
     `curl -fsSL https://offdesk.dev/install | sh` here. -->

### CLI

```bash
cargo build --release --bin offdesk    # binary: target/release/offdesk
```

Create an API token in the web UI (Settings → API Tokens → Create), then either
write it to a config file:

```toml
# ~/.config/offdesk/config.toml  (chmod 600)
# macOS: ~/Library/Application Support/offdesk/config.toml
url   = "https://your-hub.example.com"
token = "odk_..."
```

or export `OFFDESK_URL` and `OFFDESK_TOKEN`. `--url` and `--token` override
both.

### Phone

Open the hub URL in a browser. There is nothing to install.

## Two setups

- **At home, off the desk** — hub on your Mac or NAS, phone on the same Wi-Fi.
  → [docs/setup-lan.md](docs/setup-lan.md)
- **Away from home** — hub on a VPS behind Caddy, or on your tailnet.
  → [docs/setup-public.md](docs/setup-public.md)

## How it works

```
   phone / browser            your hub                  your machines
  ┌────────────────┐      ┌──────────────┐        ┌──────────────────────┐
  │  xterm.js in a │      │ offdesk-hub  │        │ offdesk-node         │
  │  browser tab   │◄────►│              │◄──────►│   tmux ── claude     │
  └────────────────┘  WS  │  Axum + WS   │   WS   │   tmux ── vim        │
                          │  SQLite      │        │   tmux ── htop       │
  ┌────────────────┐      │              │        └──────────────────────┘
  │  offdesk CLI   │◄────►│  control     │        ┌──────────────────────┐
  │  another agent │  WS  │  lease       │◄──────►│ offdesk-node (NAS)   │
  └────────────────┘      └──────────────┘   WS   └──────────────────────┘
```

Each machine runs `offdesk-node`, which opens one outbound WebSocket to the hub
and hosts every terminal as a tmux session. Nothing on the machine needs an
inbound port. Browsers, phones, and the CLI all connect to the hub, and the hub
brokers bytes between them and tmux.

**The control lease** decides who may type. It is held per (user, machine), and
sending input claims it — last writer wins, no queue. Everyone else keeps
receiving output but their keystrokes, resizes, and image pastes are dropped:
they are watching, live, not disconnected. Reading and waiting never claim it.
The lease is held in memory, so it does not survive a hub restart.

Because tmux runs with `window-size manual`, a second client attaching or
resizing does not resize anyone else's view.

## For agents and scripts

The CLI lets anything that can run a shell command — a human, a script, or
another AI agent — list, open, read, write to, and wait on terminals on any
machine registered to a hub.

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

- Machines and terminals are addressed by **id prefix** (first column of `ls`);
  ambiguous prefixes list candidates.
- Exit codes: `0` success or wait condition met · `1` wait timed out ·
  `2` usage/config/network error. `--json` on every command that prints.
- `--lines N` means "the last N rendered lines of the current screen" (after
  trailing blank lines are trimmed) in both text and JSON mode; JSON also
  reports `lines_total` (pre-slice count) and `truncated`.
- All printed and serialized output is sanitized — control bytes stripped,
  `\n`/`\t` and Unicode kept. Safe to pipe to `jq`.
- `send` types the text, then sends Enter as a **separate delayed frame**
  (150 ms plus 60 ms per newline, capped at 800 ms) so TUI apps that treat
  multi-line bursts as pastes still submit. `--no-enter` sends the text frame
  only.
- `read --all --json` lists **reachable terminals only** by default, with
  `skipped_unreachable_count` at the top level; `--include-unreachable`
  restores their `{"error":"unreachable"}` entries. Each captured entry carries
  `pane_title`, `title_source` (`osc`/`process`/`none`), `foreground_process`
  (`{has_foreground_process, process_name}`, null on lookup failure),
  `activity` (`active`/`quiet`/`idle`) and `idle_ms` — activity is observed
  during the capture window only. `cwd` is live (tmux `pane_current_path`), not
  creation-time.

### Driving an agent inside a terminal

```bash
T=$(offdesk open nas --cwd ~/projects/foo --cmd claude --json | jq -r .id)
offdesk send $T "fix the type errors in src/auth.ts; stop when tests pass"
offdesk wait $T --silence 5000 --timeout 600     # or --pattern '❯' to await a prompt
offdesk read $T --lines 80                       # collect the result
offdesk kill $T --yes
```

### Semantics you must know

1. **`send`/`key` claim control** (last-writer-wins). Other clients on the same
   account become view-only until a human reclaims. Read first if a human might
   be typing. The CLI also claims the lease for `open` and `kill`.
2. **`read`/`wait` are pure watchers.** They never claim control and never
   disturb other clients — tmux runs `window-size manual`, so attaching does
   not resize anyone's view.
3. **`read` sees the current screen only**, reconstructed from tmux's attach
   repaint. It cannot see scrollback. For long output, have the agent in the
   session write a file and read that.
4. **Don't poll with repeated `read`** — each call costs an attach, about a
   second. Hold a `wait` for the condition instead.
5. **For an overview of every terminal, use `read --all`.** Do not loop N CLI
   processes over `read`: it is N×(TLS + attach), and a consumer that doesn't
   drain stdout concurrently can deadlock on the pipe buffer.
6. `REACHABLE=no` terminals belong to offline machines and can't be attached.
   `read --all` skips them and reports the count on stderr and as
   `skipped_unreachable_count` in JSON.
7. **A token is remote code execution on every registered machine.** Mint one
   per agent, name it, and revoke it individually when you're done.

## How it compares

offdesk's row is from [docs/facts.md](docs/facts.md). Every other cell is
unverified — do not treat this table as accurate until the TODOs are filled in.

| | Any terminal program | Machines per hub | Traffic goes through | Agents can drive it via CLI | Self-hosted |
|---|---|---|---|---|---|
| **offdesk** | Yes — anything that runs in tmux | Any number, one URL | Your own hub | Yes — `open` / `send` / `wait` / `read` | Yes |
| Claude Code Remote Control | TODO | TODO | TODO | TODO | TODO |
| VibeTunnel | TODO | TODO | TODO | TODO | TODO |
| Happy Coder | TODO | TODO | TODO | TODO | TODO |
| Omnara | TODO | TODO | TODO | TODO | TODO |
| Orca | TODO | TODO | TODO | TODO | TODO |

<!-- TODO(ryan): fill the five competitor rows. Every cell needs a source URL in
     an HTML comment next to it, or it stays TODO. Do not guess. -->

## Security

**A token is remote code execution on every registered machine.** It opens
terminals and types into them, and a terminal runs whatever your shell runs.
Treat one like an SSH key, not an API key.

What the hub gives you to contain that:

- **One token per agent.** Every token has a name you choose at creation.
- **Individual revoke.** Deleting one token does not touch the others.
- **Last used.** Every token records the last time it authenticated, so you can
  tell which ones are live.
- Tokens are stored as SHA-256 hashes. The plaintext is shown once, at
  creation, and is not recoverable.

Threat model, what the control lease does and does not prevent, and what the
hub keeps in SQLite: [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

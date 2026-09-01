# offdesk

Vibe code from your phone, on the terminal running at home.
One self-hosted hub, all your machines, any agent that runs in tmux.

<!-- TODO(ryan): record docs/media/hero.gif — see docs/media/README.md -->
![Claude Code running on a desk machine, with a phone attached to the same tmux session](docs/media/hero.gif)

- **One hub, every machine.** A Mac at home, a NAS, a VPS — they all register
  to one hub and you open them from one URL. The other tools that give you a
  real terminal run one server per machine.
- **It is the real terminal, and it is just tmux.** Anything that runs in tmux
  runs here: Claude Code, Codex, Grok, vim, htop. No agent-specific
  integration, so there is nothing to add when the next agent ships — and
  nothing to be locked into. Uninstall offdesk, ssh in, `tmux attach`, and your
  sessions are still there.
- **Your hub, your traffic.** Each machine dials out to a server you run. No
  third-party relay, no vendor account, and no transcript stored anywhere you
  do not control.
- **Your phone and your desk on the same session, live.** Whoever typed last
  holds the control lease; everyone else keeps receiving output instead of
  being disconnected. tmux runs `window-size manual`, so a phone attaching
  never resizes the desk.
- **`offdesk open nas --cwd ~/app --cmd claude`** from a script, or from an
  agent on a different machine, against any machine on the hub.
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

Every cell below is from the vendor's own docs, sourced in the comment under
the table. Checked 2026-09-01; these products move fast, so re-check before
relying on any row.

| | Any terminal program | Machines per hub | Traffic goes through | Agents can drive it via CLI | Self-hosted |
|---|---|---|---|---|---|
| **offdesk** | Anything that runs in tmux | Any number, one URL | Your own hub | `open` / `send` / `wait` / `read` | Yes, MIT |
| Claude Code Remote Control | No — a Claude Code session, not a terminal | Sessions from several machines in one list | Anthropic's servers; transcript stored there | Not documented | No |
| VibeTunnel | Yes — `vt <any command>`, `vt --shell` | One server per machine | Your choice: LAN, Tailscale, ngrok, Cloudflare | Launches commands only; no send/read/wait against a running session | Yes, MIT |
| Happy Coder | No — wraps `claude` and `codex` | Several; `spawn --machine`, `machines` | slopus cloud by default, end-to-end encrypted | `create` / `send` / `history` / `wait` | Optional, MIT |
| Omnara | Agent sessions; no raw terminal documented | Several at once per agent | `api.omnara.com` by default | CLI and REST: `POST .../inputs`, SSE timeline | Optional, Apache-2.0 |
| Orca | Yes — real terminal, 30+ CLI agents | One server per machine; SSH worktrees reach out from it | Orca Relay by default, or direct on the LAN | `orca terminal create/send/read/wait` | Yes, MIT |

<!-- Sources, checked 2026-09-01.

offdesk: docs/facts.md in this repo.

Claude Code Remote Control — https://code.claude.com/docs/en/remote-control
  Terminal: it connects claude.ai/code and the Claude app to "a Claude Code
    session running on your machine"; the surface is the conversation.
  Machines: "Open claude.ai/code or the Claude app and find the session by
    name in the session list"; auto-generated names are prefixed with the
    machine hostname.
  Traffic: "it registers with the Anthropic API and polls for work. When you
    connect from another device, the server routes messages between the web or
    mobile client and your local session" and "the session transcript ... is
    stored on Anthropic servers".
  CLI: no CLI for driving a Remote Control session is documented.

VibeTunnel — https://github.com/amantus-ai/vibetunnel
  Terminal: "Run any command in the browser", `vt --shell` for an interactive
    shell. Machines: one Node server per machine; no multi-machine
    orchestration documented. Traffic: README lists Tailscale, ngrok,
    Cloudflare Quick Tunnel, Pinggy, Pangolin, or the local network.
  CLI: `vt` is "a bash script that internally calls `vibetunnel fwd`" and
    launches a new session; the only other verbs are `follow`, `unfollow`,
    `title`. Licence: MIT.

Happy Coder — https://github.com/slopus/happy
  Terminal: "Start using `happy` instead of `claude` or `codex`".
  Machines + CLI: happy-agent provides `machines`, `spawn --machine <id>`,
    `create`, `send`, `history`, `wait` —
    https://github.com/slopus/happy/tree/main/packages/happy-agent
  Traffic: default server is happy-api.slopus.com, end-to-end encrypted;
    self-hosting at https://happy.engineering/docs/guides/self-hosting/
    Licence: MIT.

Omnara — https://github.com/omnara-ai/omnara and https://docs.omnara.com/api/overview
  Terminal: the API is scoped to agent sessions; no raw shell access is
    documented. Machines: "An agent can run with no machines or use several at
    once. These can be sandboxes, your own machines, or both."
  Traffic: "Hosted routes live under: https://api.omnara.com/v1", and
    "Self-hosted deployments serve the same API from their own origin".
  CLI: "Use Omnara programmatically via the CLI, Typescript CLI, or REST API".
  Licence: Apache-2.0.

Orca — https://github.com/stablyai/orca and https://www.onorca.dev/docs
  Terminal: "anything that runs in a terminal will run inside Orca".
  Machines: https://www.onorca.dev/docs/remote-servers — `orca serve` runs
    headless and "agents keep running when the client laptop sleeps or
    disconnects", but "A Remote Orca Server is tied to a single machine ...
    one server cannot reach or manage other machines"; SSH worktrees are how
    it reaches out to another box.
  Traffic: https://www.onorca.dev/docs/mobile — "Prefer Orca Relay for pairing
    when it is available — sign-in is required for Relay only"; LAN pairing is
    the alternative.
  CLI: https://www.onorca.dev/docs/cli/overview — `orca terminal list, read,
    send, wait, create, split`. Licence: "Orca is free and open source under
    the MIT License."
-->

### What the table says

The field splits in two, and the split is not about quality.

**Fan-in, but a conversation.** Claude Code Remote Control, Happy Coder, and
Omnara all let several machines report to one place. What you get there is an
agent session, not a terminal — which is the right trade if the agent is all
you wanted.

**A real terminal, but one server per machine.** VibeTunnel and Orca both give
you a genuine terminal. Both run one server per machine: VibeTunnel by design,
Orca because a Remote Orca Server is tied to a single host and reaches other
boxes over SSH.

offdesk is the combination — one hub you run, every machine registered to it,
and a real terminal at the end. Each of the five drops one of those three.

That is the only claim this table supports, and it is narrower than "better".
If you want parallel git worktrees, diff review, and a browser and emulator
harness around your agents, **Orca** does far more than offdesk and is also
MIT. If you want one machine's terminal in a browser with the least possible
setup, **VibeTunnel** is a smaller thing to run. If you only ever drive Claude
Code and want zero setup, **Remote Control** is already in your CLI.

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

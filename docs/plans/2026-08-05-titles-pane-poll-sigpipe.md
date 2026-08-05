# Fix: rich titles via tmux pane_title polling + CLI SIGPIPE

**Status:** implementation spec (2026-08-05), two independent fixes, two commits, one PR.

## Fix 1 — machine: report tmux pane titles (rich titles without an attach)

**Problem.** Today the machine learns OSC titles only by scanning per-attach byte streams (`hub_conn.rs` OpenAttach → `OscTitleScanner`). tmux does NOT re-emit historical pane titles on attach (verified: an attach stream contains zero OSC 0/2 sequences), so rich app titles ("✳ 了解项目的功能和目的") only reach the hub when they CHANGE while someone is attached. Everything else degrades to the 5s foreground-process fallback ("claude").

**But tmux already holds the live title for every pane** (verified: `tmux -L webmux list-panes -a -F '#{session_name} #{pane_title}'` shows the rich titles). Poll it directly — no stream scanning needed.

**Verified facts / constraints.**

- Machine tmux socket: `TMUX_SOCKET = "webmux"` (`crates/machine/src/pty.rs:7`). tmux session name for a terminal: `tmux_session_name(session_id)` in pty.rs (format `wmx_<id>`).
- The existing fallback task in `crates/machine/src/hub_conn.rs` (~line 189) already loops every 5s over `pty.list_terminal_ids()` and sends `MachineToHub::TerminalTitle { title, source: Process }`. Hub arbitration (`crates/hub/src/db/terminal_sessions.rs::apply_title_update`) lets `osc` beat `process`, never the reverse — exactly what we want.
- Default pane_title for a pane whose app never set one is the machine hostname (e.g. `dev`). Treat empty OR hostname-equal titles as "no title" → fall back to process. Get hostname from `std::env::var("HOSTNAME")` once at task start (fallback: `hostname::get().to_string_lossy()` if the crate graph already has `hostname`; otherwise skip the fallback).

**Change (crates/machine only).**

- Add `PtyManager::pane_titles(&self) -> HashMap<String /*terminal_id*/, String /*title*/>` (pty.rs): runs ONE subprocess per poll — `tmux -L webmux list-panes -a -F '#{session_name}\t#{pane_title}'` — parses lines, maps `wmx_<id>` back to terminal ids (strip the `wmx_` prefix via the existing session-name helper's inverse; if none exists, a simple `strip_prefix`). Subprocess failure (tmux server down) → empty map, never panic.
- Pure parser `parse_pane_titles(&str, &hostname) -> HashMap<String,String>`: skip empty titles and hostname-equal titles. Unit-test it (normal case, empty title, hostname title, missing tab, CRLF).
- Rewrite the 5s title task in hub_conn.rs: each tick, first `pane_titles()`; for each terminal id, if a pane title exists → send `TerminalTitle { title, source: Osc }`; else keep the current foreground-process report (`source: Process`). Keep the existing process-name path untouched as the fallback.
- Keep the per-attach OscTitleScanner as-is (it still catches sub-5s updates; harmless duplication, same source).
- Note: pane_title reflects the app's LATEST title, so it naturally flows even when nobody is attached. This is the entire point.
- No protocol changes, no hub changes.

## Fix 2 — cli: exit cleanly on SIGPIPE

**Problem.** Rust ignores SIGPIPE, so `webmux ls | head -1` panics: `failed printing to stdout: Broken pipe (os error 32)`. Agents pipe CLI output constantly; this is a real papercut.

**Change (crates/cli only).** No `unsafe`, no libc signal reset. Add a small stdout helper (e.g. `commands/mod.rs::out_line(&str)` / `out(&str)`) that writes with `writeln!`/`write!` to `io::stdout().lock()` and on `ErrorKind::BrokenPipe` calls `std::process::exit(0)` (standard Unix behavior). Route ALL user-visible printing through it (ls, machines, read, read_all sections + JSON, wait/kill/open messages). stderr diagnostics keep using eprintln!.

Unit test: not feasible to test SIGPIPE in-process — instead verify via code review + the reviewer runs `webmux ls | head -1; echo $?` live (must print one line, exit 0, no panic text).

## Engineering requirements

- Two commits: `fix(machine): report tmux pane titles as OSC titles` and `fix(cli): exit cleanly on SIGPIPE`.
- Style: match existing code. No new crates beyond what's already in the workspace (machine already shells out to tmux for everything — follow those patterns).
- `cargo fmt` scoped to the touched packages only (`-p tc-machine -p tc-cli`), never repo-wide (it churns hub test files).
- `cargo clippy -p tc-machine -p tc-cli --all-targets -- -D warnings`, `cargo test -p tc-machine -p tc-cli`, `cargo check --workspace` all green.
- Do not touch crates/hub or crates/protocol. Do not commit — leave the two commits to the reviewer? NO — DO make the two commits locally (messages above), but do not push.

## Reviewer live verification

1. Rebuild + reinstall webmux-node, `systemctl --user restart webmux-node`: within ~10s, `webmux ls` titles flip from `claude` to rich task summaries (tmux currently holds e.g. "✳ 了解项目的功能和目的" for 51efb211).
2. `webmux ls | head -1; echo $?` → one line, exit 0, no panic.
3. `webmux read --all --lines 1` still works (titles only — no behavior change elsewhere).

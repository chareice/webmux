# Batch C: title_source on the wire + live cwd via pane_current_path

**Status:** implementation spec (2026-08-05). Branch `feature-live-cwd-source`, stacked on `feature-cli-agent-output`.
**Scope:** crates/protocol + crates/hub + crates/machine + crates/cli. **Additive only** — every change must degrade gracefully with a mixed-version fleet (verified compatibility notes below).

## 1. `TerminalInfo.title_source` (protocol + hub)

- `crates/protocol`: add `None` variant to `TerminalTitleSource` (serializes as `"none"` via the existing `rename_all = "snake_case"`), add `impl Default for TerminalTitleSource { None }`, and add to `TerminalInfo`:
  ```rust
  #[serde(default)]
  pub title_source: TerminalTitleSource,
  ```
- `crates/hub`: fill it. The DB already stores `title_source` strings ("osc"/"process"/"none") — extend `title_source_name`/`apply_title_update`'s mapping to cover `None` ↔ `"none"`, and populate the field wherever hub builds `TerminalInfo` for REST responses (machine_manager listings / routes). Fix every construction site (Rust will list them — including machine-side `ExistingTerminals` mapping, which sets `title_source: Default::default()`).
- Serde compat: old peers ignore/drop the unknown field; new peers default it when missing. Both directions safe.

## 2. Live cwd: machine reports `pane_current_path` (protocol + machine + hub)

- `crates/protocol`: new additive message variant
  ```rust
  MachineToHub::TerminalCwd { terminal_id: String, cwd: String }
  ```
  Old hubs fail to deserialize ONLY this message and drop it via the existing `continue` path in `handle_machine_ws` (verified `crates/hub/src/ws.rs:593`) — other messages unaffected.
- `crates/machine`: the 5s title task already runs `tmux list-panes -a -F '#{session_name}\t#{pane_title}'` (batch A). Extend the format to `#{session_name}\t#{pane_title}\t#{pane_current_path}` and the parser (rename to something like `parse_pane_info`, keep the old unit tests + add: 3-col normal, missing path col → no cwd, empty path → skip). Track a `last_sent_cwd: HashMap<String,String>` in the task; send `TerminalCwd` only when a terminal's path changed since last sent (titles keep their current every-tick behavior).
- `crates/hub`: handle it in machine_manager next to `TerminalTitle` — `UPDATE terminal_sessions SET cwd = ?1 WHERE id = ?2 AND destroyed_at IS NULL` (skip no-op writes: `AND cwd != ?2`), and when a row changed, update the in-memory terminal + broadcast `BrowserEvent::TerminalUpdated` exactly like the title flow. Unknown terminal id → ignore silently (same as title Rejected).

## 3. CLI surfaces them

- `read --all` JSON entries gain `"title_source"` (from the listing). Live `cwd` arrives for free via `/api/terminals` once hub stores it — no extra calls.
- `ls` text output: no change. `ls --json` passes the new field through automatically if it uses serde types — verify.

## Docs

- README: one line — `title_source` in `read --all` JSON; `cwd` is now live (tmux `pane_current_path`, refreshed ~5s) instead of creation-time.

## Engineering requirements

- Unit tests: protocol roundtrip (`title_source` default + `"none"` variant), hub cwd apply (changed/unchanged/missing terminal), machine `parse_pane_info` (3-col/2-col/empty cases), CLI JSON entry contains `title_source`.
- `cargo fmt -p tc-protocol -p tc-hub -p tc-machine -p tc-cli` (scoped ONLY to these four; never repo-wide — it churns unrelated test files).
- `cargo clippy` for the four packages `--all-targets -- -D warnings`, `cargo test` for the four packages, `cargo check --workspace`. All green.
- ONE commit: `feat: live terminal cwd and title_source through the protocol`. Do not push.

## Reviewer live verification (not the implementer)

1. Rebuild+reinstall webmux-node, restart: within ~15s `webmux ls` shows real project paths instead of `/home/chareice` for sessions whose apps changed dir (or after `send`ing `cd /tmp` to a sacrificial terminal).
2. `webmux read --all --json | jq '.terminals[0] | {cwd, title_source}'` shows live cwd + osc/process/none.
3. Old-binary compat is by design (unknown variant dropped) — code-review the `continue` path, no live test needed.
4. Mobile/web session sheet cwd updates (bonus, visual only).

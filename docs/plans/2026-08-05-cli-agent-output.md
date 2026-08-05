# CLI agent-consumable output: sanitize, --lines parity, send paste timing, --all activity fields

**Status:** implementation spec (2026-08-05). Branch `feature-cli-agent-output`, stacked on `fix-titles-and-sigpipe` (uses its `out_line` helper).
**Drivers:** real hermes failures — NUL bytes in JSON ("file" reports binary), `--lines` ignored in JSON mode (screen truncated mid-way by the consumer), multi-line `send` not submitting in Claude Code ("[Pasted text #N +15 lines]" stuck in the input box), unreadable noise from 19 unreachable entries, and no way to tell active/waiting/idle apart.

All changes in **crates/cli only** (+ README + `docs/plans`). No hub/machine/protocol changes. `read`/`wait` stay pure watchers.

## 1. Sanitize all output text (P0)

Add `sanitize_screen(&str) -> String` (attach.rs or a new text.rs): drop every char `< 0x20` except `\n` and `\t`, drop `0x7f`. Apply to EVERY user-facing string that comes from terminal content or machine data before printing/serializing: `screen` in read/read_all (text + JSON), and `title`/group/cwd fields in JSON entries (titles flow from tmux/apps — untrusted bytes).

Tests (pure): string containing NUL, ESC, BEL, an OSC sequence, DEL, CJK + emoji + wide chars, `\r`, `\t`, `\n` → controls gone, `\n`/`\t`/wide chars kept.

## 2. `--lines` parity between text and JSON (P0/P1)

Today `read --json` ignores `--lines` (dumps the full trimmed screen — consumers truncate mid-string, losing the prompt at the bottom). Fix: apply the existing `last_n_lines` slice in the JSON path too, after trimming — `--lines N` = "the last N rendered lines of the current screen" in BOTH modes.

JSON entries (read + read_all) gain:
- `lines_total`: number of lines after blank-trim, before slicing
- `truncated`: true iff `--lines` sliced anything off

## 3. `send` multi-line paste-end timing (P0)

Today: one frame `text + \r`. Claude Code's TUI treats a multi-line burst as a paste and swallows the trailing `\r` into the paste — the message sits in the input box unsubmitted ("[Pasted text #N +15 lines]").

New `plan_send_frames(text, enter) -> Vec<(String, Duration)>` (pure, unit-tested):
- always: first frame = the text as-is, then (when `enter`) a delay, then a separate `"\r"` frame
- delay = `min(150ms + 60ms × newline_count, 800ms)` (multi-line pastes need the TUI to finish digesting before Enter lands)
- `--no-enter`: text frame only — pure paste, unchanged semantics

`send_inputs` walks the frame plan, sleeping between frames. Unit tests: single-line, multi-line delay scaling + cap, no-enter, empty text.

## 4. `read --all`: reachable-only default + count (P1)

- JSON: default output = reachable entries only, plus `"skipped_unreachable_count": N` at the top level. New flag `--include-unreachable` restores the error entries.
- Text mode: unchanged (the one-line `-- id · cwd · skipped (unreachable) --` rows stay — compact and useful for humans).

## 5. `read --all` activity fields (P1)

Per JSON entry, alongside existing fields:

- `pane_title`: the terminal's stored title (rich OSC/task title when the machine reports it, else legacy) — from the listing already fetched, no extra calls.
- `foreground_process`: from `GET /api/machines/{m}/terminals/{t}/foreground-process` → `{has_foreground_process, process_name}`; fetch inside the same bounded-concurrency stage as the capture; on any error → null, never fail the batch.
- `activity`: computed from the capture itself —
  - `"active"`: capture ended by overall timeout AND bytes arrived within the last quiet window (something is streaming)
  - `"quiet"`: capture ended by the quiet timer (bytes arrived, then stopped)
  - `"idle"`: no bytes arrived at all during the capture
- `idle_ms`: ms between the last received byte and capture end (null when no bytes ever).

`attach::capture` must therefore return a small report (screen, end_reason, last_byte_age_ms) instead of just a screen — update `read` accordingly (single read gains the same fields in JSON mode). Document the semantics in --help ("activity is observed during the capture window only").

## Docs

- README: `--lines` semantics line; `send` multi-line note (delayed Enter, `--no-enter` = pure paste); `read --all` JSON fields incl. `skipped_unreachable_count` / `--include-unreachable` / activity fields; one line on sanitize ("output is safe to pipe to jq/file").
- `docs/plans/2026-08-03-webmux-cli.md`: follow-up pointer.

## Engineering requirements

- Reuse existing helpers (`out_line` from the sigpipe commit for ALL printing, `trim_trailing_blank_lines`, `last_n_lines`, bounded `buffer_unordered`).
- Unit tests for: sanitize, lines slicing in both modes, plan_send_frames, activity classification (from synthetic end_reason/ages), reachable-only JSON shape. No network in tests.
- `cargo fmt -p tc-cli` only; `cargo clippy -p tc-cli --all-targets -- -D warnings`; `cargo test -p tc-cli`; `cargo check --workspace`. All green.
- Make ONE commit `feat(cli): agent-consumable output — sanitize, --lines parity, send paste timing, --all activity fields`. Do not push.

## Reviewer live verification (not the implementer)

1. `webmux read --all --json | jq .` parses; `| file -` says JSON/text, not binary; scan all 9 prod terminals for raw NUL/ESC bytes in both modes.
2. `read <id> --json --lines 5` ends with the prompt line; `truncated`/`lines_total` correct.
3. Real Claude Code session: `webmux open --cmd claude` on this machine, `send` a 3-line message, `wait`/`read` to prove it actually submitted (input box cleared / queued or processing indicator), then `kill`. Also verify `--no-enter` leaves it in the input box.
4. `read --all --json` has zero unreachable entries + correct count; `--include-unreachable` brings them back.
5. Activity fields: an actively-running session shows `active` (or quiet with small idle_ms), an idle prompt shows `quiet`.

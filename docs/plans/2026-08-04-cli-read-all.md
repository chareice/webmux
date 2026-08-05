# `webmux read --all` — batch screen capture

**Status:** implementation spec (2026-08-04)
**Goal:** one-shot overview of every terminal — the "有哪些进行中的任务" command. Replaces the N-processes × N-attaches pattern that agents fall into today (which is slow and invites consumer-side pipe deadlocks).

## Context

`read <term>` attaches as a watcher, feeds the byte stream into vt100, and dumps the screen after output goes quiet (`--quiet-ms`, default 500) or `--timeout` (default 10s). All of that machinery stays; this adds a batch mode over it.

Real-world trigger: an agent looped `webmux read` over 28 terminals (9 reachable, 19 on an offline machine) and its tool hung. Per-invocation reads are fine (0.7s live-verified), but N sequential processes are slow and N parallel processes are rude.

## CLI shape

```
webmux read --all [--machine <id>] [--lines N] [--json] [--quiet-ms 500] [--timeout 10s] [--concurrency 8]
```

- `read` currently takes positional `<term>`. Make it `Option<String>`; exactly one of `<term>` / `--all` is required (clap `conflicts_with`, and a usage error exit 2 if neither).
- `--machine <id prefix>`: only terminals on that machine (reuse prefix resolution).
- Unreachable terminals (`reachable == false`): **skip attaching**, include them in output as `{error}` entries (JSON) / one-line `skipped (unreachable)` rows (text). Count them in a final stderr note: `skipped N unreachable terminals`.

## Behavior

- One `GET /api/terminals`, filter, then attach to each reachable terminal with **bounded concurrency** (default 8; `futures::stream::iter(...).map(...).buffer_unordered(n)` is fine) reusing the existing `attach::capture` unchanged (per-terminal quiet + timeout semantics as-is).
- A terminal that errors mid-capture (WS close, hub error frame) does NOT fail the batch — it becomes an `{error: "..."}` entry.
- Exit codes: 0 when the listing succeeded and every REACHABLE terminal was captured or recorded as an entry (per-terminal failures are data, not exit codes). 2 only for systemic failures (auth, REST down, no terminals matched is exit 0 with an empty result).

## Output

Text mode, one section per terminal, screens trimmed with the existing `trim_trailing_blank_lines` (+ `--lines` slice), sections separated by a blank line, deterministic order (the REST listing order):

```
== 54eb98a5 · tab 3 · /home/chareice · 107x59 ==
<screen text>

== 3c361a41 · /home/chareice · 107x59 ==
<screen text>

-- 2bf50be0 · /home/chareice/projects/webmux · skipped (unreachable) --
```

(Header: `== shortid · group · cwd · COLSxROWS ==`; group omitted when none; skipped entries use the `-- ... --` one-line form.)

JSON mode: `{"terminals": [...]}` where each entry is either
`{"id","short_id","machine_id","title","group","cwd","cols","rows","screen"}`
or `{"id","short_id","machine_id","title","group","cwd","error":"unreachable" | "<message>"}`.
`group` = workspace group name when resolvable from the listing data already fetched, else null — do NOT add extra REST calls for group names if the terminals payload doesn't carry them; use whatever the existing `ls` command already derives.

## Engineering requirements

- All new code in `crates/cli` (likely `commands/read.rs` + a `read_all.rs`; reuse `attach`, `client`, `resolve`). No changes to hub/machine/protocol.
- Unit tests: section/JSON rendering with synthetic captures (reachable + skipped + mid-capture error), neither-term-nor---all usage error, `--machine` filtering. No network in tests.
- `cargo fmt -p tc-cli` only (never repo-wide — it churns hub/machine test files), `cargo clippy -p tc-cli --all-targets -- -D warnings`, `cargo test -p tc-cli`, `cargo check --workspace` all green.
- Update the CLI's own `--help` text for `read`.

## Docs (same PR)

- `README.md`: add `read --all` to the command list with one line; in the "Semantics you must know" section add a batch note: for overviews use `read --all` — do not loop N CLI processes (slow: N×TLS+attach; and consumers that don't drain stdout concurrently can deadlock on the pipe buffer).
- `docs/plans/2026-08-03-webmux-cli.md`: one-line status note pointing at this follow-up spec.

## Live verification (reviewer runs, not implementer)

Against the production hub (token already on this machine): `webmux read --all` over 28 terminals (9 reachable, 19 unreachable), wall-time it, check text + `--json` + `--lines 5` + `--machine`, and pipe a full run to a file to prove no pipe stall.

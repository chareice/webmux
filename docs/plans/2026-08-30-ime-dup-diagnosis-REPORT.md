# IME duplicate-commit race — DIAGNOSIS REPORT

- Date: 2026-08-30
- Branch: `perf-ws-compression` (worktree `perf-input-scroll`), PR #301
- Failing test: `e2e/tests/mobile-ime-composition.spec.ts:225`
  "IME rapid repeated commits send each commit exactly once"
- Status: IN PROGRESS (findings appended incrementally)

## Log

### Setup

- Stack: default-project compose (`docker compose -f e2e/docker-compose.yml
  up -d --build hub node`), peer's `e2e-fable` stack on 4327 untouched.
- Iteration method: `docker compose ... run --rm -v ./e2e/tests:/work/e2e/tests:ro
  runner pnpm exec playwright test <spec>` — the bind mount bypasses the
  stale `COPY e2e e2e` image layer noted in the compression E2E report.
- Throwaway spec: `e2e/tests/zz-ime-repro.spec.ts` (to be deleted). Copy of
  the failing test plus:
  - `IME_THROTTLE` env → CDP `Emulation.setCPUThrottlingRate`
  - `IME_TRACE=1` env → in-page instrumentation on the live terminal
    (`window.__webmuxTerminals` → `term._core`):
    - capture-phase listeners on `core.textarea` for
      compositionstart/update/end, beforeinput, input, keydown/keyup
      (logs data, inputType, composed, isComposing, value, selection)
    - wrapper on `coreService.triggerDataEvent` (logs payload + stack)
    - wrappers on CompositionHelper methods + `_inputEvent`
    - `_compositionPosition`/`_dataAlreadySent`/`_isComposing`/
      `_isSendingComposition`/`_compositionSuffix` turned into logged
      accessors (timers are closures, can't be wrapped directly)
    - trace dumped to `e2e/artifacts/ime-trace/trace-{pass|FAIL}-*.json`

### xterm source facts (6.1.0-beta.303)

`packages/app/node_modules/@xterm/xterm/lib/xterm.js` is stock upstream —
`CompositionHelper.ts` and `CoreBrowserTerminal._inputEvent` extracted from
the source map are byte-identical to upstream master. No local patches.

Three textarea-driven paths can reach `triggerDataEvent`:

- **I — `CoreBrowserTerminal._inputEvent`**: acts only on
  `inputType === 'insertText'`; ignores `insertCompositionText`. Also gated
  by `(!ev.composed || !this._keyDownSeen)`. Blink creates all editing input
  events with `composed: true`, and the spec's single `rawKeyDown 229` (no
  keyup ever dispatched) latches `_keyDownSeen = true` for the whole run.
- **T — `CompositionHelper._finalizeComposition(true)`** (compositionend):
  defers via `setTimeout(0)`; at run time computes the committed text from
  the LIVE textarea: `value.substring(capturedStart, valueEnd)` (not
  composing) or `value.substring(capturedStart, liveNewCompositionStart)`
  (composing again). Dedup vs path C: `capturedStart +=
  _dataAlreadySent.length` (issue #3191 guard). All pending T-timers share
  ONE boolean `_isSendingComposition`; whichever runs first clears it and
  cancels the rest.
- **C — `CompositionHelper._handleAnyTextareaChanges`** (229 keydown while
  not composing): snapshots `oldValue` at keydown, diffs on `setTimeout(0)`,
  sends the diff and sets `_dataAlreadySent = diff`.

### First instrumented failure trace (un-throttled, instrumentation overhead)

Trace: `e2e/artifacts/ime-trace/trace-FAIL-1788052602151.json`.

WS-level result: `['测','测','测测','测测']` = 6×测 for 5 commits (the run3
shape from CI: same-tick pairs coalesced by the app input batcher).

Established from the trace:

- Every CDP-driven commit produces `compositionupdate`/`compositionend` +
  `input` with `inputType=insertCompositionText`, `composed=true` — the same
  event sequence a real IME generates (CDP `Input.insertText` maps to
  `ImeCommitText`, the real IME commit IPC).
- `I:_inputEvent` fired for every input event, `handled: false` every time —
  the `_inputEvent` path NEVER emits in this scenario (insertCompositionText
  + composed + latched `_keyDownSeen`).
- The C-timer (armed once by the lone 229 keydown) never sent — it fired
  while `_isComposing` and no-op'd.
- ALL `测` sends came from a single call site — the T-timer
  (`_finalizeComposition`'s `setTimeout(0)`).
- Failure arithmetic (pinned by the trace timeline):
  - T_1 (commit 1) fired LATE, during composition 2 → `_isComposing` branch
    → sent `value.substring(0, 1)` = `测` ✔ (by luck, correct).
  - T_2 fired during composition 3 → `测` ✔.
  - T_3 (scheduled at compositionend_3) was starved past compositionend_4.
    Ran between compositions 4 and 5 with the textarea already holding
    `测测测测` → else-branch `value.substring(capturedStart=2, valueEnd=4)`
    = `测测` — commits 3 AND 4 in ONE send.
  - T_4 was then cancelled by the shared `_isSendingComposition` boolean
    (T_3 cleared it), so commit 4 was not sent a second time — but T_3's
    wide send had already absorbed it.
  - T_5 sent `测测` instead of `测` (over-send, the actual duplicate).

Conclusion so far: the double-fire is entirely inside CompositionHelper's
deferred T-timer, driven by compositionend/insertCompositionText — the
events real IMEs produce. The CDP-synthetic `insertText` (`_inputEvent`)
path is provably NOT involved. Exact per-timer arithmetic being pinned with
accessor tracing next.

### Second trace batch: 6x throttle + accessor tracing — 10/10 FAILED

Full state trace: `e2e/artifacts/ime-trace/trace-FAIL-1788053120410.json`
(representative). WS log `['测','测测测','测测测','测测测']` = 10×测 for 5
commits. Two send call sites confirmed: C-timer (`_handleAnyTextareaChanges`)
and T-timer (`_finalizeComposition`'s `setTimeout(0)`). `_inputEvent` again
`handled:false` throughout — never a sender.

Pinned arithmetic (GET/SET accessor logs resolve every send):

- C-timer @t=1642.6 sent `测` (commit 1) and set `_dataAlreadySent='测'`.
  compositionstart_2 then reset `_dataAlreadySent=''` — the #3191 dedup
  token is destroyed by the next compositionstart, exactly as suspected.
- T_1 (captured {0,0}) starved behind input tasks until composition 4 was
  active. The shared `_isSendingComposition` boolean had been continuously
  re-armed by compositionend_2/_3, so it still read true. T_1 computed its
  region from LIVE state: `substring(0, live _compositionPosition.start=3)`
  = `测测测` (commits 1–3; commit 1 now sent TWICE).
- T_2 (captured {1,1}) ran even later; the flag had been re-armed by
  compositionend_4. Region `substring(1, live pos.start=4)` = `测测测`
  (commits 2–4; commits 2,3 duplicated, commit 4 first time).
- T_3 (captured {2,2}) ran after compositionend_5 re-armed the flag;
  `_isComposing=false` → else branch `substring(2, live valueEnd=5)` =
  `测测测` (commits 3–5; commits 3,4 duplicated, commit 5 first time).
- T_4, T_5: flag finally cleared by T_3 → skipped. Their commits had been
  absorbed by the stale timers' over-wide regions.

Root cause (both CI shapes + the local ~8-9% flake, one mechanism):
`_finalizeComposition(true)`'s deferred send computes its region at RUN time
from live shared state — live `_compositionPosition.start` of whatever
composition is newest, live `textarea.value` for the end, and live
`_dataAlreadySent` for the #3191 offset — while cancellation is a single
shared boolean that every compositionend RE-ARMS. Under main-thread
starvation (CI 2-core, CPU throttle, slow mobile devices) the 0ms T-timers
queue behind high-priority input tasks; each re-arm lets a stale timer fire
with an over-wide region, and the timer that should have covered those
commits is then cancelled. The captured `currentCompositionPosition` copy
(their existing guard for exactly this interleave) only captures start/end —
it does not stop the region's END from being derived live.

Reachability by real IMEs: the failing sequence is
compositionstart/update/end + insertCompositionText only — bit-identical to
what a real mobile IME produces (CDP `Input.insertText` = `ImeCommitText`,
the real IME commit IPC; CDP `imeSetComposition` = the real set-composition
path). No synthetic-only event is involved in the duplicate. Even with NO
229 keydown at all (no C-timer), starved T-timers alone duplicate:
T_1 sends commits 1–3, re-armed T_2 sends 2–4, re-armed T_3 sends 3–5. This
is the same mechanics as upstream xterm.js issue #5023 (real Wubi/WeChat
keyboards), which upstream has NOT fixed (this beta's CompositionHelper.ts
is byte-identical to upstream master).

DECISION: option (b) — PRODUCT fix. The spec's event sequence is faithful
to real IMEs; relaxing it would drop coverage of a real product bug
(duplicate CJK input on slow devices).

### Task 1 — throttle sweep (no instrumentation, 20 repeats each)

- 6x: failures observed (exact count lost to log truncation; ≥2/20).
- 10x: **14/20 failed (70%)** — chosen as the verification throttle.
- (With instrumentation overhead, 6x failed 10/10 — the wrappers themselves
  starve the main thread further.)

### Task 3 — product fix implemented

`packages/app/components/TerminalView.xterm.tsx`:
`patchCompositionHelperSendRace(term)`, wired next to the existing
`patchScaledMouseCoordinates` instance patch (restore fn in the effect
cleanup). Approach: a watermark (`emittedPrefixLength`) tracking how much of
the textarea prefix has already been emitted to onData; every deferred send
region is clamped to start at or after it.

- `_finalizeComposition` reimplemented (async branch): region start =
  `max(capturedStart + live _dataAlreadySent.length, watermark)`; end logic
  upstream-verbatim (live new-composition start when re-composing, else
  suffix-aware valueEnd), plus a `Math.max(start, end)` guard against
  substring's argument-swap. Watermark advances by exactly what was sent.
  The sync (Enter-mid-composition) branch is upstream-verbatim + watermark
  advance. This strictly subsumes the broken `_dataAlreadySent` guard: the
  watermark survives compositionstart, the token does not.
- `_handleAnyTextareaChanges` reimplemented: grow branch skips the already
  emitted prefix (`substring(max(watermark, oldValue.length))`); shrink and
  replace branches upstream-verbatim; watermark = new value length after
  any accounted send.
- `compositionstart` wrapped: if the textarea shrank below the watermark
  (cleared on blur / Enter), resync watermark to the new composition start.
- NOT blind dedupe: payload content is never compared; the clamp is purely
  positional, so legitimate `测测` input is unaffected.
- pnpm-patch of @xterm/xterm was rejected: the package ships only minified
  single-line bundles; the patch diff would be unreviewable and would have
  to duplicate across xterm.js/xterm.mjs.

Checks so far: `pnpm typecheck` green, `pnpm test` green (41 files / 331).
Behavior review against the other spec cases (single commit, commit-then-
continue, ASCII-after-commit, English composition): exactly-once preserved
in all interleavings (walked through by hand against the patch logic).

### Task 4 — verification

- Hub image rebuilt with the fix; confirmed the served TerminalView chunk
  contains the patch (fresh build timestamp, `_handleAnyTextareaChanges`
  occurrence count up from xterm's baseline 2 to 6).
- Repro spec at 10x throttle (the level that failed 14/20 pre-fix):
  **20/20 PASSED** (0/20 failures).
- Traced passes at 10x (`trace-pass-1788054412615/415658.json`): timers
  still starve and coalesce exactly as before (one send covering 5 commits,
  or 4+1) — but sends are positionally disjoint now: `['测测测测测']` and
  `['测测测测','测']`. Exactly 测×5 on the wire. The clamp fixes the race
  without changing the coalescing behavior the spec's joined-string
  assertion tolerates.
- Full `mobile-ime-composition.spec.ts` un-throttled, `--repeat-each=10`:
  **50/50 PASSED**.
- Throwaway spec + instrumentation deleted; kept traces:
  `e2e/artifacts/ime-trace/trace-FAIL-1788052602151.json` (un-throttled
  fail, 4-message shape), `trace-FAIL-1788053120410.json` (6x fail, pinned
  arithmetic), two post-fix pass traces.
- Full e2e suite (`pnpm e2e:test`, documented container path, runner image
  rebuilt with --no-cache to dodge the stale-CACHED COPY layer; compression
  ON by default): **83/83 PASSED**, runner exit 0 (log: /tmp/e2e-full-run.log
  during the session).

## Final state

- Product fix (uncommitted): `packages/app/components/TerminalView.xterm.tsx`
  — `patchCompositionHelperSendRace` (+173 lines), wired at terminal setup
  with a restore in the effect cleanup. No spec changes: the strict
  exactly-once assertions stand, and now pass under CI-like slowness.
- The failing test's driver needed no changes — the CDP event sequence was
  proven faithful to real IMEs, and the duplicate was a real product bug
  (upstream xterm.js#5023 mechanics), not a test artifact.
- Verification: repro 0/20 at 10x throttle (was 14/20), IME spec 50/50
  un-throttled, full suite 83/83 with compression on.
- `pnpm typecheck` + `pnpm test` green. No commits made. Throwaway spec and
  instrumentation deleted; key traces kept under
  `e2e/artifacts/ime-trace/` (gitignored).
- Note: the same watermark fix would benefit upstream; not filed as part of
  this task.

DIAGNOSIS COMPLETE

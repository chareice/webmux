# E2E: simulated-device verification for IME input and touch scrolling

Goal: verify the mobile fixes on branch `perf-input-scroll` without a
physical phone, by driving Chromium's *real* input pipeline via CDP instead
of hand-dispatched synthetic DOM events.

Two new specs under `e2e/tests/`. Follow the conventions of the existing
mobile specs (e.g. `mobile-link-tap.spec.ts`): mobile viewport + touch
enabled, screen text read through the `__webmuxTerminals` buffer API
(`translateToString`), never `.xterm-rows` DOM (WebGL has no DOM text).

## Shared plumbing

- Get a CDP session: `const cdp = await page.context().newCDPSession(page)`.
- To capture exactly what the client sends to the PTY, add an init script
  (before app load) that wraps `WebSocket.prototype.send` and appends every
  parsed `{type:"input"}` payload's `data` to `window.__wsInputLog: string[]`.
  This gives byte-exact duplicate detection independent of shell echo.
- Focus the terminal first (tap it) so xterm's hidden textarea has focus —
  CDP IME calls target the focused element.

## Spec 1: `mobile-ime-composition.spec.ts`

Simulate IME input with CDP `Input.imeSetComposition` (composition updates)
and `Input.insertText` (commit). These produce trusted
compositionstart/update/end and input events through Chromium's editing
pipeline — the same code paths a mobile IME exercises. Keydown 229 can be
added with `Input.dispatchKeyEvent` (`rawKeyDown`, `windowsVirtualKeyCode:
229, key: 'Process'`) before composition updates for mobile realism.

Scenarios (each asserts `window.__wsInputLog` joined equals EXACTLY the
expected committed string — nothing doubled, nothing dropped — and that the
echoed screen text matches once):

1. **Plain CJK commit** (pinyin-style): compose `n` → `ni` → `你` → commit
   `你好` via `Input.insertText`. Expect exactly `你好`.
2. **Commit-then-continue** (Wubi/WeChat dual-function key, upstream
   issue #5023 pattern): compose, commit `狠狠`, immediately start a new
   composition in the same tick sequence, commit `的`. Expect `狠狠的`.
3. **Mixed CJK + ASCII punctuation after composition** (CompositionHelper
   `_handleAnyTextareaChanges` path): commit `你好`, then a bare `1` typed
   with keydown 229 + `Input.insertText('1')`. Expect `你好1`.
4. **Rapid repeated commits**: commit `测` five times in quick succession.
   Expect exactly `测测测测测` (catches stale-textarea resends).
5. **English through IME** (WeChat keyboard composes ASCII too): compose
   `h`→`he`→`hello`, commit `hello`. Expect `hello`.

Sanity guard: run scenario 1 with the terminal at a bash prompt inside the
e2e stack; also read back the screen to confirm the prompt echoed the text
once. If any scenario fails on current code (i.e. the xterm 6.1 upgrade did
NOT fix it), report the failing event trace in detail rather than papering
over it — that trace is the repro we need.

## Spec 2: `mobile-touch-scroll.spec.ts`

Seed scrollback first (`seq 1 300` at the prompt, wait for output). Then use
CDP `Input.dispatchTouchEvent` sequences (touchStart / ~8 touchMove at
16 ms spacing / touchEnd) — dispatch with realistic coordinates inside the
terminal.

Assertions:

1. **Slow drag tracks ~1:1**: drag up slowly by exactly N line-heights
   (below the 0.4 px/ms momentum threshold), wait for tmux, and assert the
   copy-mode position advanced by N ± 2 lines. Read the position from the
   copy-mode badge tmux draws in the top-right of the screen (`[x/y]`,
   via buffer text + regex), or by comparing which seq numbers are visible.
2. **Fling has momentum**: fast swipe (release velocity well above
   0.4 px/ms). Record the scroll position immediately at touchend, then
   poll: position must keep advancing for a while after the finger is gone,
   then settle (two consecutive equal polls).
3. **Tap stops a fling**: start a fling, then tap mid-glide. Position must
   freeze within ~2 polls, and the tap must NOT exit copy-mode or activate
   anything (screen content unchanged apart from the badge).
4. **No overshoot jitter at rest**: after settle, poll 5× — position stable
   (guards against the wheel-gate/copy-mode re-entry regression class).

Note: the momentum implementation samples velocity with `performance.now()`
at event receipt. If CI event pacing makes velocity flaky, it is acceptable
to switch the implementation to `event.timeStamp` (same clock basis,
per-event accuracy) — a small, behavior-preserving change to
`TerminalView.xterm.tsx`'s touch block; add it only if needed and note it.

## Running

Serial with any other compose run. Use the documented flow:

```sh
docker compose -f e2e/docker-compose.yml up --build -d hub node
docker compose -f e2e/docker-compose.yml run --rm runner \
  npx playwright test tests/mobile-ime-composition.spec.ts tests/mobile-touch-scroll.spec.ts
```

Frontend changes require rebuilding the hub image (the web bundle is baked
in); spec-only changes only need the runner. Iterate until green; if a spec
exposes a real product bug, fix the product (within the constraints of the
main perf spec) and re-run. Report per-scenario results honestly — including
any scenario you could not make deterministic.

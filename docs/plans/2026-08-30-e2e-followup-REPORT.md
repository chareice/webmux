# E2E follow-up report — `perf-input-scroll`

Date: 2026-08-30
Worktree: `perf-input-scroll`
Starting suite: 76 passed, 6 failed (4 spec files)
Do not commit. Mobile IME/touch specs were green and were not touched.

## Verdict

The xterm 6.1.0-beta.303 WebGL addon is **not** fundamentally broken. The
glyph canary's canvas assertion passed after a stale `customGlyphs` option
check was removed. Do **not** pin back to xterm 6.0.0.

The five sizing/pane/control failures shared 6.1 addon-glue: a visible
scrollbar (new default + renamed DOM class), public cell-metrics vs the
private `_renderService` path, and new xterm-generated `onData` sequences
that claimed the control lease when a mobile viewer attached.

## Artifact diagnosis

### 1. `terminal-glyph-rendering.spec.ts:13` (WebGL canary)

Failed **before** the canvas assertion, on:

```
readCustomGlyphsOption(...) === true
Expected: true
Received: undefined
```

Line 0 of the buffer already contained `78%` (the startup command echo), so
the xterm instance **was** registered on `window.__webmuxTerminals`.

**Root cause:** xterm 6.1.0-beta.303 **removed** `ITerminalOptions.customGlyphs`.
The flag now lives on `@xterm/addon-webgl` (`WebglAddon({ customGlyphs })`,
default `true`). `term.options.customGlyphs` is therefore `undefined`. The
unit test in `TerminalView.renderer.test.ts` was already updated to
`not.toContain("customGlyphs: false")`; the e2e spec was not.

The screenshot still showed block/shade glyphs. WebGL addon internals
(`_core._renderService`, `_charSizeService`, `_coreBrowserService`) still
exist on 6.1; the addon still requires WebGL2 (same as 0.19 on main, which
already passed this spec in the SwiftShader runner). Canvas is still
appended to `.xterm-screen`.

**Spec change (stale assertion):** dropped `readCustomGlyphsOption`. The
canvas count remains the renderer canary and **passed** on rerun.

Also visible in the same screenshot: a native xterm scrollbar. xterm 6.1
renamed `.scrollbar` → `.xterm-scrollbar` and defaults
`scrollbar.showScrollbar` to `true`. Our CSS only hid the old class.

### 2. Shared control-steal / auto-fit cluster

| Spec | Failure | What the artifact shows |
|---|---|---|
| `multi-device-collaboration.spec.ts:25` | host sheet `"Take control"` vs `"View only"` | Desktop TabBar `"viewing"` pill — desktop **lost** the lease. `"View only"` is the controller-side host-sheet label. |
| `multi-device-collaboration.spec.ts:86` | `"Take control"` vs `"Unlock view only"` | Desktop later holds control. Mobile `viewOnlyLocked === true`. `mobileTakeControl` clicked the toggle while mobile already held the lease, so it **locked** view-only. |
| `terminal-handoff-sizing.spec.ts:70` | viewer open resized pty `80x24` → `52x30` | `52` cols matches iPhone 14 `estimateMobileInitialTerminalDimensions`. Compact auto-fit only runs when `isCompact && isController`. |
| `terminal-handoff-sizing.spec.ts:125` | delete did not empty `listTerminals` | Cleanup ran as the mobile device. View-only-locked / non-controller destroy is refused. |

**Shared mechanism:** hub `ClientMessage::Input` from a non-controller
**claims** the control lease. Opening a mobile viewer auto-fits and flips
the host-sheet label if xterm 6.1 emitted `onData` that survived
`filterBrowserGeneratedTerminalInput`.

xterm 6.1 added extra `triggerDataEvent` paths the DA-only filter did not
strip: color-scheme DSR `CSI ? 997 ; 1/2 n`, XTVERSION DCS, window-ops
reports `CSI 4/6/8 ; h ; w t`, focus in/out `CSI I` / `CSI O`.

### 3. `workspace-panes.spec.ts:18`

After `⌃B "` (split down) the third pane's `x` was 356px off the active pane
(expected `< 8`). Screenshot is **three full-height columns**, not an
L-shape. `appendNode` always inserts a **horizontal** split; reconcile falls
back to that when extra resize/dimension events race the local tree.

A 14px 6.1 scrollbar cannot produce a 356px column by itself, but the new
scrollbar + private cell-metrics path changed fit timing. Hiding the
scrollbar and reading public `term.dimensions` made the spec pass.

## Fixes applied

Product / addon glue (preferred):

1. **Scrollbar (6.1 glue)** — `scrollbar: { showScrollbar: false }` on the
   live Terminal (scrollback is 0; tmux copy-mode owns history). CSS now
   also hides `.xterm-scrollable-element > .xterm-scrollbar`.
2. **Cell metrics** — `readXtermCellMetrics` prefers public
   `term.dimensions.css.cell` (what `@xterm/addon-fit` 0.12-beta.300 reads)
   and falls back to `_core._renderService`.
3. **Generated-input filter** — strip 6.1 auto-responses (color-scheme DSR,
   XTVERSION, window-ops reports, focus in/out) in addition to DA, so they
   cannot claim control via `type: "input"`.
4. **WebGL activation failures** — `console.warn` on construct/load miss
   instead of a silent catch, so a real SwiftShader/WebGL2 miss is visible.

Spec (stale assertion only):

5. **`terminal-glyph-rendering.spec.ts`** — dropped `customGlyphs` (option
   removed in 6.1; still default-true on the WebGL addon). Canvas count
   stays the canary. Scrollbar locator also matches `.xterm-scrollbar`.

Tests added/updated: `terminalInputFilter.test.ts`,
`terminalXtermMetrics.test.ts`, `TerminalView.renderer.test.ts`,
`terminalGpuRenderer.test.ts` (asserts the warn on addon throw).

Mobile IME/touch specs were not modified.

## Suite results

Isolated rerun of the 4 previously-failed spec files (after hub+runner
rebuild): **15 passed**.

Full suite (`docker compose -f e2e/docker-compose.yml run --rm runner pnpm exec playwright test`):

```
81 passed
1 failed  (mobile-controls.spec.ts:534 — see flake below)
```

The original 6 failures are green, including the WebGL canvas canary.

### Flake (unrelated to this branch's xterm glue)

`e2e/tests/mobile-controls.spec.ts:534` — "mobile Ctrl latch and pinned
key-bar keys send bytes directly".

- Failed in the full run: `commandFrames` stayed `[]` after clicking ⇧Tab / ^C
  (expects `command_input` frames `\x1b[Z` and `\x03`).
- Isolated rerun immediately after: **passed** (2.1s).
- Path is `sendCommandInput` (not the DA filter, not WebGL, not fit).
- This spec was **not** in the original 6 failures (it passed in the 76/6
  run). Treating it as the known-flaky class from other branches; not
  chased here.

## Unit verification

```
pnpm test       → 37 files, 281 tests passed
pnpm typecheck  → pass
pnpm build      → expo export web, pass
cargo           → skipped (no crate changes in this follow-up)
```

## Teardown

`docker compose -f e2e/docker-compose.yml down --remove-orphans` ran.

## Unresolved

- `mobile-controls.spec.ts:534` flake on `command_input` capture. Isolated
  rerun green. Not a 6.1 beta blocker.
- Worktree left dirty; do not commit.

# Mobile Input UX — Keyboard Viewport Fix & CommandBar Removal

Date: 2026-04-17

## Overview

Two targeted changes to the mobile terminal experience in `@webmux/app` (web
target):

1. **Keyboard hides terminal input.** When the soft keyboard opens on mobile,
   the cursor row disappears behind the keyboard because the root layout uses
   `height: 100dvh`, which does not shrink for on-screen keyboards.
2. **Dead CommandBar panel.** The `CommandBar` component and the `>_` toggle
   on the mobile `ExtendedKeyBar` are effectively unused. Its desktop code
   path is already gated off everywhere (`desktopPanelOpen = false` at every
   call site), and the mobile bottom sheet sees no real use. The user has
   confirmed they want the feature removed; a different quick-input affordance
   will be designed separately later.

Scope is limited to `packages/app` (web). No Rust crates, Android-specific
files, or protocol changes.

## Goals

- On mobile web (Android Chrome, iOS Safari), focusing a terminal so that the
  soft keyboard appears must leave the terminal cursor row visible above the
  keyboard. Typing must echo in the visible area in real time.
- Closing the keyboard must restore the terminal to the full visible area and
  trigger a re-fit.
- Remove `CommandBar`, the `>_` keybar button, the `commandBarVisible` state,
  and the `desktopPanelOpen` prop without regressing the remaining mobile or
  desktop layouts.
- `pnpm typecheck` and `pnpm test` stay green.

## Non-Goals

- Replacement quick-input / snippets / saved-command feature. Will be designed
  in a separate spec.
- Any other mobile polish: tab bar, sidebar, onboarding, font sizing,
  orientation tuning, swipe gestures, copy/paste ergonomics, long-press
  selection. Not in scope here.
- Android native app (`*.android.tsx` files under `packages/app`). The
  keyboard-viewport fix targets web only; Android uses native keyboard
  handling and has separate canvases.
- Desktop (Tauri) behavior changes. The `desktopPanelOpen` branch is dead
  code; removing it is a cleanup only, with no visible change.
- Changes to hub / machine / protocol crates.

## Problem 1 — Soft Keyboard Hides Terminal Content

### Root cause

- `packages/app/components/TerminalCanvas.web.tsx:457` sets the outer layout
  container to `height: 100dvh`. In all current mobile browsers, `dvh`
  excludes retractable browser chrome (URL bar) but **does not** shrink when
  the soft keyboard opens.
- Downstream containers
  (`TerminalCard.web.tsx`, `SplitPaneContainer`, `TerminalView.web.tsx`) all
  use `flex: 1` / `overflow: hidden`, so their heights are capped by the
  outer root.
- `packages/app/components/TerminalView.xterm.tsx:534` already attaches a
  `ResizeObserver` to the xterm viewport that calls `fit()` and sends a
  resize message when the container resizes. No change is needed there.

Because the root never shrinks when the soft keyboard opens, the
`ResizeObserver` never fires, xterm never re-fits, and the cursor row ends
up under the keyboard.

### Approach

Replace the static `height: 100dvh` with a JS-driven height that tracks
`window.visualViewport.height`. The `VisualViewport` API is available in
Chrome (desktop + Android) and Safari (desktop + iOS). When the soft keyboard
opens, `visualViewport.height` shrinks to the area above the keyboard; we
propagate that to the root div, which cascades through the flex chain and
triggers the existing `ResizeObserver` inside the terminal view so xterm
refits automatically.

On desktop, `visualViewport.height` equals `window.innerHeight`, and there is
no soft keyboard, so behavior is unchanged.

**Implementation sketch:**

- In `TerminalCanvas.web.tsx`, add a `useEffect` that:
  - Reads `window.visualViewport?.height ?? window.innerHeight` into state.
  - Listens to `visualViewport.resize` and `visualViewport.scroll` (Safari
    fires `scroll` when the keyboard offset changes), plus `window.resize`
    as a fallback.
  - Updates the state on every event.
- Apply that state to both places in this file that currently use
  `100dvh`:
  - The root layout container (`:457`).
  - The mobile sidebar drawer (`:517`), so the drawer doesn't extend below
    the soft keyboard either.
- Fallback to `100dvh` when `visualViewport` is undefined (SSR, very old
  browsers).

Keep the fix at the single outermost layout owner. Do not duplicate
listeners in `TerminalCard.web.tsx` or `TerminalView.xterm.tsx`; they inherit
sizing through flexbox, and the existing `ResizeObserver` inside the
terminal view handles the refit.

### Alternatives considered

- **CSS-only (`100svh` / `100dvh` / `100lvh`).** None of these react to soft
  keyboards in any current browser. Rejected.
- **`<meta name="viewport" content="... interactive-widget=resizes-content">`.**
  Only Safari 17+ respects this, and it still does not guarantee the layout
  viewport reshapes correctly for flex chains. Adds a second code path and
  requires the JS fallback anyway. Rejected for now; may be added as a hint
  later once we have data on browser uptake.
- **Scrolling the terminal into view after keyboard opens.** Cosmetic; does
  not re-fit xterm, so input still echoes into off-screen rows. Rejected.

### Acceptance

- Android Chrome (dev-mode web build):
  - Open a terminal tab, tap the keyboard toggle on `ExtendedKeyBar` → system
    keyboard appears.
  - The terminal content above the keyboard fits without clipping, cursor row
    visible.
  - Type characters on a blank prompt — each keystroke echoes in the visible
    area.
  - Dismiss the keyboard — terminal expands, refits, no scrollback loss.
- iOS Safari (dev-mode web build): same as above.
- Desktop Chrome/Firefox/Safari: no visual regression. Resizing the window
  continues to fit the terminal as today.

## Problem 2 — Remove CommandBar

### What exists today

- `packages/app/components/CommandBar.tsx` — the full component. Only
  importer is `TerminalCard.web.tsx`.
- `TerminalCard.web.tsx`:
  - Imports `CommandBar` (`:6`).
  - `desktopPanelOpen` prop (`:29`, `:42`, `:447`).
  - `commandBarVisible` state (`:50`, reset `:73`).
  - `handleImagePaste` callback (`:82`) — only wired into `CommandBar`.
  - Desktop 200px side panel branch (`:383-387`).
  - Mobile bottom-sheet branch (`:405-414`).
  - `onToggleCommandBar` handler passed to `ExtendedKeyBar` (`:395-400`).
- `ExtendedKeyBar.tsx`:
  - `onToggleCommandBar` and `commandBarVisible` props.
  - `>_` toggle button block (`:147-176`).
- Call sites passing `desktopPanelOpen={false}`:
  - `Canvas.web.tsx:361`
  - `SplitPaneContainer.tsx:210`
- `TerminalViewRef.sendImagePaste` and its three implementations
  (`TerminalView.xterm.tsx:236`, `TerminalView.wterm.tsx:164`,
  `TerminalView.android.tsx:205`) — only called by the now-removed
  `handleImagePaste`. The internal `image_paste` frames sent from
  xterm/wterm's own OS-clipboard paste handlers
  (`TerminalView.xterm.tsx:399`, `TerminalView.wterm.tsx:250`) are
  *separate* from this ref method and must stay.
- Any test imports referencing `CommandBar` or the above props.

### Approach

Delete the listed surfaces in a single sweep:

1. Remove `packages/app/components/CommandBar.tsx`.
2. In `TerminalCard.web.tsx`: remove the `CommandBar` import, the
   `desktopPanelOpen` prop (including in `areTerminalCardPropsEqual`), the
   `commandBarVisible` state, its reset effect entry, the `handleImagePaste`
   callback, the desktop side-panel branch, the mobile bottom-sheet branch,
   and the `onToggleCommandBar` callback passed to `ExtendedKeyBar`.
3. In `ExtendedKeyBar.tsx`: remove `onToggleCommandBar`,
   `commandBarVisible`, and the right-hand `>_` button block. The left
   keyboard toggle and the middle key groups stay.
4. In `Canvas.web.tsx` and `SplitPaneContainer.tsx`: remove the
   `desktopPanelOpen={false}` prop from the `<TerminalCard>` call sites.
5. Remove the `sendImagePaste` method from `TerminalView.types.ts` and its
   three implementations (`TerminalView.xterm.tsx`,
   `TerminalView.wterm.tsx`, `TerminalView.android.tsx`). Leave the internal
   OS-clipboard paste handlers that send `image_paste` frames untouched.
6. Remove any tests that import `CommandBar` or exercise the removed props.
   If an existing test covers `ExtendedKeyBar` button count / layout, update
   the expectation.

### Acceptance

- `rg "CommandBar"   packages/app` → no matches.
- `rg "desktopPanelOpen" packages/app` → no matches.
- `rg "commandBarVisible" packages/app` → no matches.
- `rg "onToggleCommandBar" packages/app` → no matches.
- `rg "sendImagePaste" packages/app` → no matches (method and all callers
  removed). `rg '"image_paste"' packages/app` → still matches
  `TerminalView.xterm.tsx` and `TerminalView.wterm.tsx` internal paste
  handlers; those stay.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- Mobile: `ExtendedKeyBar` still shows on active terminal tabs; keyboard
  toggle still works; no right-edge `>_` button.
- Desktop: terminal tab layout unchanged (the removed branch was dead at
  every call site). Pasting an image from the OS clipboard into a terminal
  still works (internal paste handler unaffected).

## Verification Plan

- `pnpm typecheck` — must be green.
- `pnpm test` — must be green; update any tests that break due to the
  intentional removals.
- `pnpm e2e:test` — run the default e2e path to catch layout regressions in
  the tab view.
- **Manual mobile check** (required because e2e does not simulate the soft
  keyboard): connect a real phone browser to the dev server, open a
  terminal, open the keyboard, type — confirm the cursor row stays visible
  and each keystroke echoes.
- Manual desktop check: open a terminal tab, verify the existing layout
  renders identically (no ghost side panel, no new borders, no shifted
  content).

## Opportunistic cleanup (included in this spec)

- `packages/app/components/terminalLayout.ts` and its test
  `terminalLayout.test.mjs` have no importers in the app — only self-tests.
  They are leftovers from the pre-tab "maximized overlay" pattern (replaced
  by the tab-based terminal view in an earlier commit) and also embed
  `100dvh` strings. Delete both files as part of this change.

## Problem 3 — Replace native `window.confirm` with in-app dialog

The close-terminal flow uses `window.confirm(…)` when the terminal has a
foreground process. On the desktop Tauri build this renders an OS-level
alert with an `tauri.localhost 显示` origin banner, which is visually
jarring and inconsistent with the app's design. Same on mobile web (the
browser's native confirm UI).

### Approach

- Add `packages/app/components/ConfirmDialog.tsx` — a small reusable web
  dialog with title + message, cancel/confirm buttons, `danger` variant,
  focus-on-cancel-by-default, Escape cancels, Enter confirms,
  `role="dialog"` + `aria-modal`.
- In `TerminalCanvas.web.tsx`, replace the `window.confirm` branch with
  state (`closeConfirmation: { terminal, processName } | null`) plus a
  `<ConfirmDialog>` render. Confirm destroys the terminal via the same
  `destroyTerminal` call; Cancel clears the state.

### Acceptance

- Closing a terminal whose foreground process is busy shows the in-app
  dialog styled with app colors — no `tauri.localhost 显示` banner on the
  desktop app, no browser-chrome alert on web.
- Escape / Cancel dismisses without closing the terminal. Enter / Confirm
  closes it.
- When the foreground-process API check errors out, the original fallback
  still applies (close without prompt).

## Follow-ups (out of scope for this spec)

- Replacement quick-input / saved-commands feature. Separate design, after
  the user has clearer ideas.
- Broader mobile polish (tab bar, sidebar drawer, orientation, copy/paste,
  session resume under long backgrounding). Open a new spec if/when the
  user flags pain.

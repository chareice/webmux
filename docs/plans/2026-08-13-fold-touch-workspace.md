# Fold touch-workspace (Galaxy Z Fold 8)

**Status:** retired (2026-08-15). After two days of real-device use the
unfolded inner screen felt worse in the desktop chrome than in the mobile
layout: stacked splits got cramped once the soft keyboard took half the
~840px height, and keyboard-driven viewport panning fought the multi-pane
grid. `classifyDisplayMode` now returns `isCompact: true` for every touch
device, so both Fold screens use the single-column `MobileWorkbench`. The
two-axis model, the touch affordances (long-press menus, key-bar portal,
stacked-split rendering), and this document are kept for reference; the
large-touch quadrant is simply no longer reachable.

**Original status:** implemented (2026-08-13). Web frontend only — no Rust, Android shell, or MobileWorkbench UX changes.

**User story:** unfolding a Fold (or rotating the cover to landscape) must not flip the chrome into a mouse-only desktop, and the inner screen must expose the split workspace with touch affordances (key bar, long-press menus, 40px tab hits).

## Problem

`useIsMobile()` was a window-width check at 768px. The Fold 8 straddles that line:

| Surface | CSS px (approx) | Old classifier |
|---|---|---|
| Cover portrait | 384×832 | compact (correct) |
| Cover landscape | 832×384, sometimes ~940 wide | **desktop** (wrong) |
| Inner, any orientation | ~757×840 | **flips** as width crosses 768 |
| Soft keyboard | shrinks `innerWidth` / visualViewport | can flip chrome |

When the Fold landed in the desktop branch there were zero touch affordances: hover-to-focus, right-click pane/tab menus, no ExtendedKeyBar, 34px tab row.

## Two-axis display mode

`classifyDisplayMode` / `useDisplayMode()` in `packages/app/lib/displayMode.ts` + `hooks.ts`:

- **`isTouch`**: `matchMedia("(pointer: coarse)")`, falling back to `navigator.maxTouchPoints > 0`.
- **`isCompact`**:
  - touch → `min(screen.width, screen.height) < 600`. Screen dims, not window, so a keyboard resize or cover-landscape rotation cannot flip chrome. Folding/unfolding *does* change `screen.width/height` on Android and reclassifies on `resize`.
  - non-touch → legacy `window.innerWidth <= 768`.

Native (`Platform.OS !== "web"`): `isTouch = true`, `isCompact` from `Dimensions` window width ≤ 768.

### Four quadrants

| | compact | large |
|---|---|---|
| **touch** | Phone / Fold cover → `MobileWorkbench` (unchanged) | Fold inner → desktop `TabBar` + split `TerminalWorkspace` + portaled key bar |
| **non-touch** | Narrow desktop window → compact chrome (legacy) | Mouse desktop → unchanged |

## Key-bar portal

Ctrl-latch / select-mode / keyboard-toggle / attach state stays inside `TerminalCard`. Lifting it would couple every pane to the workspace.

On large+touch the active card (`isTab && isTouch && !isCompact && isActive`) `createPortal`s the existing `<ExtendedKeyBar>` into `workspace-keybar-slot` at the bottom of the desktop `<main>`, provided by `KeyBarSlotProvider`. Compact (phone) still renders the bar inline. Empty slot has no reserved height.

## Touch affordances

- **Long-press** (`packages/app/lib/longPress.ts`): Pointer Events, 500ms hold, 10px slop. Opens the same pane context menu as right-click (Split / Rotate / Close / …) and the same tab menu (Rename / Delete). Select-mode overlay is excluded so native text selection still works there. The tracker is gated on `isTouch`, not `pointerType`.
- **Hover-to-focus** and TabBar hover-to-select are off when `isTouch`.
- **Hit targets** when `isTouch`: tab row and `+` ≥ 40px. Split seams stay the original 1px `gap` — they are not draggable, so a 40px overlay would only swallow taps.
- **Stacked splits**: touch workspaces render every split as a single column (full-width panes, new pane below). Side-by-side terminals on a ~760–840 px screen get ~40 cols each — too narrow. Render-time only: the persisted split direction is untouched, so desktop clients keep their saved arrangement.

## Fold / unfold continuity

Both chrome branches read the same `TerminalCanvas` state (`layout.zoomedTerminalId` / `workspaceTerminal`). Remounting MobileWorkbench vs TabBar resets chrome, not the active terminal id. `TerminalWorkspace` rebuilds from `terminal.id` + siblings + persisted layouts.

`rootHeight` already tracks `visualViewport` on the canvas root, so both branches shrink with the soft keyboard.

ResizeObserver on xterm only remeasures. Touch *large* workspaces additionally `requestPaneFit` on `window.resize` (fold / inner rotation). Mouse desktop is left alone so existing fit-stability contracts stay intact.

## Deliberately not done

- No draggable split dividers (and no 40px seam overlay).
- No Device Posture / hinge APIs — screen short-edge is enough for Fold 8.
- Command palette and the ⌃B prefix engine stay mounted on large screens (hardware keyboards on the inner display). Compact chrome still disables them.
- No Playwright changes to MobileWorkbench UX, Rust crates, or the Android Tauri shell.

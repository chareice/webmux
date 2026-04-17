# Nav Redesign + Tabs Within Workpath

**Date:** 2026-04-17
**Supersedes:** the rail+overlay nav from 2026-04-17-main-ui-redesign-design.md
**Branch:** all-hot-corner (worktree)

## Why

The rail+overlay nav from PR #133 has structural problems users hit immediately:

- **Two surfaces showing the same info.** The 56px rail shows two-letter abbreviations of every workpath (`tt`, `wm`, `az`); the overlay shows the same workpaths with full names. Hovering different rail pills produces the *same* overlay. The user's verbatim feedback: "我hover到任何一个 workpath，怎么出来的内容都是一样的，那还有必要展示不同的workpath吗" — if hovering anywhere shows the same thing, what's the point of separate pills?
- **Unreadable rail.** Two-letter abbreviations don't survive a quick glance. Users can't recognize their own workpaths without hovering.
- **Hover triggers are fragile.** PR #137 had to add document-level pointermove tracking + `collapseAfterAction` to keep the overlay reachable. Each iteration adds complexity to paper over an interaction model that wasn't load-bearing in the first place.
- **No tabs.** To switch between two terminals in the same workpath the user must: select workpath → see grid → click card → zoom. Tabs would be one click. The previous (pre-PR #133) UI had tabs and we removed them on the assumption workpaths replaced them; they don't — they solve different problems (group by project vs. switch between siblings inside a project).

## What

A VS Code-like three-column layout. The rail+overlay duo collapses into one always-visible workpath panel. Tabs come back, scoped per workpath. Hot-corner / hover triggers are removed entirely.

## Architecture

```
┌─────┬─────────────┬───────────────────────────────────────┐
│ A   │ Workpath    │ Tab strip                       + chip│
│ c   │ panel       ├───────────────────────────────────────┤
│ t   │             │                                       │
│ i   │             │   Active terminal (immersive)         │
│ v   │             │   — or —                              │
│ i   │             │   All grid (when "All" selected)      │
│ t   │             │   — or —                              │
│ y   │             │   Empty state (workpath has no termsl)│
│     │             │                                       │
│ 48  │ 200–240px   │ flex: 1                               │
└─────┴─────────────┴───────────────────────────────────────┘
```

### Activity bar (left, 48px, conditional)

- **Visible only when machine count > 1.** Single-machine users never see it; the workpath panel just adds the global actions to its own footer.
- **Top section:** machine badges. Selected machine = filled accent color; others = muted background. Click switches `activeMachineId`.
- **Bottom section (multi-machine only):** global actions — `+` (add directory), `⚙` (settings).
- **No workpath badges, no quick-cmd shortcuts, no "All" pill.** Anything workpath-scoped lives in the panel.

### Workpath panel (~200–240px, default open, collapsible)

- **Always shows full workpath info:** label, path (subtitle), terminal count, live indicator (●). No abbreviations.
- **Sections, top to bottom:**
  - Header: machine name + os (when single machine; when multi-machine the activity bar carries machine identity, header collapses to just `Workpaths` label).
  - `All` row at the top, separator, then the bookmark list.
  - Add-directory affordance + (single-machine only) `+` and `⚙` actions at the bottom.
- **Click selects that workpath.** No hover-to-preview. Hover gives only the standard list-row highlight.
- **Empty bookmarks** still get a synthetic `~` row from the parent (existing behavior preserved).
- **Cmd/Ctrl+B toggles open/closed.** Closed state hides the panel entirely; activity bar (if shown) stays.

### Canvas (right, flex: 1)

The canvas content depends on `selectedWorkpathId`, `zoomedTerminalId`, and the existence of terminals in scope:

| selectedWorkpathId | zoomedTerminalId | terminals in scope | canvas shows                            |
|--------------------|------------------|--------------------|-----------------------------------------|
| `"all"`            | `null`           | any                | All grid of cards                       |
| `"all"`            | terminal X       | —                  | Immersive of X (no tab strip)           |
| specific workpath W| `null`           | 0                  | Empty state (large `+` + chips)         |
| specific workpath W| `null`           | ≥ 1                | Tab strip + immersive of W's first term |
| specific workpath W| terminal X (in W)| ≥ 1                | Tab strip + immersive of X              |

In workpath scope with zoom = `null`, the canvas auto-renders the tab strip and uses the first terminal in the workpath as the visually-active tab — without dispatching `ZOOM_TERMINAL`. The first explicit click on another tab dispatches `ZOOM_TERMINAL`. This avoids forcing an opinion on first paint while keeping the tab strip useful immediately.

In All scope with zoom = X, the canvas shows just the immersive terminal — no tab strip, because "all open terminals" doesn't fit a strip and the All grid is the natural exit (`Esc` or click `All` in panel).

### Tab strip (workpath scope only)

```
┌──────────────────────────────────────────────────┬─────────────────┐
│ ● main │ ● vitest │ ● git log │ ...              │  +  claude  cx  │
│   active                                         │                 │
└──────────────────────────────────────────────────┴─────────────────┘
   ◄──── horizontal scroll ────►                      pinned right
```

- **Each tab:** live dot (● green = activity, ● grey = idle) + title (`title` field, defaults to last cwd segment or running command) + close `×` (visible on hover only).
- **Active tab:** deeper background + accent-colored top border (2px).
- **Order:** creation time. No drag-to-reorder (YAGNI; revisit if asked).
- **Overflow:** horizontal scroll on the tab area. We already have wheel-to-horizontal scroll code (PR #128) — reuse.
- **Pinned right region:** `+` (new blank terminal in this workpath) followed by quick command chips (one chip per configured command). Chips after the first 3 collapse into a `⋯` dropdown to keep horizontal space sane.
- **Closing the last tab in a workpath** does NOT auto-jump to All. It drops to the empty state for that workpath. The user is still "in" the workpath; closing one terminal isn't an exit signal.

### All view grid

- Same card layout as today's overview, with one addition: each card shows a small `workpath · title` label in the top-left corner (e.g. `webmux · vitest`) so the user can tell which workpath a card belongs to without opening it.
- Cards are clickable to zoom; close button on each card.

### Empty state (workpath, no terminals)

- Centered: workpath label (large), path (smaller, muted), then a primary `+ New terminal here` button (with the `Cmd+Shift+T` hint below it).
- Below the primary button: `Quick commands` label + chips for each configured quick command. Same chip style as the tab strip's pinned region.

## Mobile

- Mobile shell is unchanged in concept: hamburger button at top-left toggles a slide-in drawer.
- The drawer renders the same activity bar (if multi-machine) + workpath panel as desktop.
- Tap outside (the dimmed area) closes the drawer.
- Tab strip on mobile uses the same horizontal scroll (touch swipe).

## Keyboard shortcuts

| Shortcut             | Action                                            | Status     |
|----------------------|---------------------------------------------------|------------|
| `Cmd/Ctrl+B`         | Toggle workpath panel                             | existing   |
| `Cmd/Ctrl+0`         | Switch to All view (also unzooms)                 | **new**    |
| `Cmd/Ctrl+1`–`9`     | Select Nth workpath in the panel list             | existing   |
| `Cmd/Ctrl+Shift+T`   | New blank terminal in current workpath            | existing   |
| `Cmd/Ctrl+W`         | Close the active tab                              | existing   |
| `Cmd/Ctrl+Tab`       | Next tab in current workpath                      | **changed**|
| `Cmd/Ctrl+Shift+Tab` | Previous tab in current workpath                  | **changed**|
| `Esc`                | Clear `zoomedTerminalId` (workpath: tab indicator falls back to first; All: returns to grid) | existing, semantics clarified |

`Cmd+Tab` previously cycled across all visible terminals in the current scope. Now it's bounded to the workpath: with tabs back, "next tab" naturally means the next sibling in the strip.

## Removed

- `WorkpathRail` (rail) component
- `WorkpathOverlay` component (its bookmark management migrates into `WorkpathPanel`)
- Document-level pointermove hover tracking from `NavColumn`
- `collapseAfterAction` callback wiring
- `columnForceExpanded` semantics — replaced by `panelOpen` (boolean: open/closed; default open)
- `addDirectoryOpen` flag in TerminalCanvas — replaced by inline `PathInput` toggle owned by the panel itself
- The previously-considered hot-corner / hover-trigger for All — redundant once the panel is always visible and Cmd+0 exists.

## Components (file structure)

The new pieces map to focused files:

| File                                              | Role                                                  |
|---------------------------------------------------|-------------------------------------------------------|
| `packages/app/components/ActivityBar.web.tsx`     | New. 48px left strip; machines + global actions.      |
| `packages/app/components/WorkpathPanel.web.tsx`   | New. The 200–240px column listing workpaths.          |
| `packages/app/components/TabStrip.web.tsx`        | New. The per-workpath tab row + pinned right region.  |
| `packages/app/components/WorkpathEmptyState.web.tsx` | New. Empty state when workpath has no terminals.   |
| `packages/app/components/NavColumn.web.tsx`       | Slim down — pure layout container for `ActivityBar` + `WorkpathPanel`. No more rail/overlay. |
| `packages/app/components/Canvas.web.tsx`          | Updated to render `TabStrip` + immersive terminal in workpath scope; All-grid in All scope; `WorkpathEmptyState` when workpath has no terminals. |
| `packages/app/components/TerminalCanvas.web.tsx`  | Plumbing: drop `addDirectoryOpen` state, drop `forceExpanded` toggle, pass new shortcut handlers. |
| `packages/app/lib/mainLayoutReducer.ts`           | Rename `columnForceExpanded` → `panelOpen`; default `true`. Reducer otherwise unchanged. |
| `packages/app/lib/shortcuts.ts`                   | Add `Cmd+0` (`Digit0`); rescope `Cmd+Tab` semantics — actual scoping done by the handler in `TerminalCanvas`. |

Removed:
- `packages/app/components/WorkpathRail.web.tsx`
- `packages/app/components/WorkpathOverlay.web.tsx`
- `packages/app/components/TerminalBreadcrumb.web.tsx` (replaced by tab strip; current breadcrumb's "back to workpath" affordance is implicit — switching panel selection)

## Data flow

State stays in the same places it already does:
- `bookmarks`, `terminals`, `machines`, `controlLeases` — `TerminalCanvas` (unchanged).
- `layout` (selected workpath, zoomed terminal, panel open/closed) — `mainLayoutReducer` (one rename: `columnForceExpanded` → `panelOpen`).

`TabStrip` props are derived purely from existing `terminals` filtered by `selectedWorkpathId`. The "active tab" = `layout.zoomedTerminalId` (when in workpath scope). Clicking a tab dispatches `ZOOM_TERMINAL`.

## Behavior decisions (rapid fire)

- **Default panel state:** open. New users see the panel.
- **Panel persistence:** `panelOpen` persists in `localStorage` (key `webmux:panel-open`) across reloads. Same pattern as device id and font.
- **Selecting a workpath from the panel:** dispatch `SELECT_WORKPATH` (which clears `zoomedTerminalId` per current reducer). The Canvas renders the tab strip with the first terminal as visually-active when `zoomedTerminalId` is null. No second dispatch needed; "active tab" derives from `zoomedTerminalId ?? firstTerminalInWorkpath`.
- **Auto-zoom on terminal create** (existing): preserved. Creating a terminal from chip / `+` / `Cmd+Shift+T` dispatches `TERMINAL_CREATED` which sets both `selectedWorkpathId` and `zoomedTerminalId`.
- **Closing the active tab:** if other tabs remain, the visually-active tab falls back to the first remaining one (no explicit dispatch — derive). If none remain, the canvas drops to the empty state.
- **Esc semantics:** in workpath scope, `Esc` clears `zoomedTerminalId` (if set) — visual effect: the active tab indicator falls back to the first tab. In All scope with a zoomed terminal, `Esc` clears `zoomedTerminalId` and returns to the All grid.
- **All view sibling chips:** removed (was in `TerminalBreadcrumb`). Tabs replace them.
- **Animation:** crossfade (150–200ms opacity transition) on canvas content when `selectedWorkpathId` or `zoomedTerminalId` changes. Single CSS transition; no spring/physics. Skipped when `prefers-reduced-motion`.

## Out of scope (explicitly)

- Drag-to-reorder tabs.
- Tab pinning.
- Renaming workpaths inline (use existing add/remove flow).
- Cross-workpath tab switcher (Cmd+P style).
- Replacing the All grid with grouped tab rows.

## Risks / open notes

- **TabStrip vs immersive resize coupling.** The auto-fit effect in `TerminalView.{xterm,wterm}` (PR #137) reacts to viewport size. A tab strip adds ~32px of vertical chrome; fit should still measure the *terminal viewport*, which already excludes chrome via `viewportRef`. No code change expected, but verify in test.
- **Cmd+Tab on browsers.** Some browsers intercept Cmd+Tab for app switching at the OS level — preventDefault works on most platforms but is genuinely unreliable on macOS Safari. We accept the constraint; in Tauri desktop it works fine, and in Chrome/Firefox web the existing `event.preventDefault()` already handles it.
- **localStorage panelOpen + SSR/initial render flicker.** Read once on first render in `createInitialMainLayout`; if the read fails, default `true`. No flicker risk because we hydrate before first paint in the SPA.

## Test plan

- **Unit (vitest):**
  - `mainLayoutReducer.test.ts` — `panelOpen` rename + default `true`. Add cases for the new `TOGGLE_PANEL` action (or keep `TOGGLE_NAV_FORCE_EXPANDED` and just rename the field).
  - `shortcuts.test.ts` — add `isAppShortcut` case for `Cmd+0`, plus a handler test that `selectTab(0)` is invoked.
- **Component (vitest, where it exists):** `tabStripFilter.test.ts` if we introduce a helper for "tabs in workpath" + "active tab resolution". Resist over-testing pure JSX components.
- **E2E (Playwright):**
  - Update `tab-navigation.spec.ts` to exercise the new tab strip: open 3 terminals in one workpath, verify all 3 tabs visible, click each, close one, verify focus moves.
  - New `tab-overflow.spec.ts`: open 8 terminals, verify horizontal scroll works (wheel + drag) and active tab auto-scrolls into view.
  - Update existing tests that asserted on `data-testid="workpath-rail"` / `workpath-overlay` to use the new `activity-bar` / `workpath-panel` testids.
  - New `panel-toggle.spec.ts`: Cmd+B closes/opens panel; persists across reload.
- **Manual:** verify the auto-fit still works with tab strip chrome; verify mobile drawer renders activity bar correctly with multi-machine and hides it with single-machine.

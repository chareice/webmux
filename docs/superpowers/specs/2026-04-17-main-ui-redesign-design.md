# Main UI Redesign — Vertical Workpath Tabs + Collapsible Sidebar

## 1. Problem

The current desktop/web layout assumes the user is actively typing into one terminal at a time. In practice the app is mostly used as a **monitoring dashboard** for agentic tools (Claude Code and similar) running in parallel across several projects on the same machine.

Two frictions follow from that mismatch:

1. The 260 px sidebar is always visible even though bookmarks are only consulted when creating a new terminal, wasting horizontal space that the monitoring grid could use.
2. The horizontal tab strip is keyed per-terminal (`Terminal f4fe…`, `Terminal d678…`). When five or six agents are running across two or three projects, the strip becomes a jumble of opaque ids with no project grouping — you cannot tell at a glance which project has activity.

## 2. Goals

- Make "which project has live work" visible without any interaction.
- Free horizontal pixels for the terminal grid.
- Keep the sidebar / bookmark library one click away, not gone.
- Preserve current split-pane, quick-command, and control-mode behaviors.

## 3. Non-goals

- Mobile redesign. Existing off-canvas drawer stays; everything below describes desktop/web ≥ 768 px.
- Multi-machine UX beyond "it still works". Most users have one machine; the design accommodates N but does not optimize layout for many.
- Reworking individual terminal rendering, WebGL canvas, or the resume protocol.

## 4. Structure

Three-layer navigation:

```
Left column (vertical workpath tabs + library)
  └─ Overview grid (cards for all terminals in the selected workpath)
      └─ Zoomed single-terminal view (one terminal + local switcher)
```

The left column replaces **both** the current 260 px sidebar **and** the horizontal per-terminal tab strip. Those two elements are gone as persistent global UI. A per-terminal switcher still exists but only within the zoomed view.

### 4.1 Left column (primary navigation)

**Collapsed state (default)** — 56 px wide, always visible:

- Top: machine badge. Shows the machine name if it fits in the rail (≤ 5 chars), otherwise a 2-char abbreviation. Multi-machine stacks badges vertically; the selected machine's badge is highlighted.
- Separator.
- `All` pill — always present, not removable.
- One pill per bookmarked workpath (ordered by `sortOrder` from `listBookmarks`).
- Each pill shows:
  - Short tag (2 chars by default, up to 3 if needed to resolve collisions) derived deterministically from the bookmark label. `webmux` → `wm`, `z1` → `z1`, `tag-tracing` → `tt`. Full label shown in native tooltip on hover.
  - Small circle indicator when the workpath has at least one live terminal (terracotta `#d97757` when live, muted when all idle, hidden when no terminals).
  - Terminal count below the indicator when > 0.
- Selected pill: left edge gets a 2 px terracotta bar and a subtle highlight background.
- Bottom: `+` (add bookmark) and `⚙` (settings).

**Expanded state** — 240 px overlay:

- Triggered by pointer entering the column (hover-expanded) or by `Cmd/Ctrl+B` (force-expanded).
- Overlays the content area with a shadow; **does not** reflow the grid.
- Hover-expanded collapses on pointer leave after a ~200 ms grace period.
- Force-expanded ignores hover; stays expanded until `Cmd/Ctrl+B` is pressed again. Useful when you want to browse bookmarks without a timer watching you.
- Shows machine name + OS header, the `All` row, and each bookmark with full label, full path, and quick-command chips (`c`, `cx`, user-defined).
- Per-bookmark `×` button deletes the bookmark (same API as today).

### 4.2 Overview grid

Rendered when `All` or a workpath is selected.

- Info bar at the top of the content area:
  - Left: active machine name, control-mode badge (`Controlling` / read-only), CPU / MEM / terminal count. This is the information that currently lives on the horizontal tab strip's right side.
  - Right: `Stop Control` / `Take Control` toggle. Same behavior as today.
  - `+ New terminal` button opens a terminal in the current workpath. When `All` is selected the button opens a directory picker.
- Cards below in the existing auto-fill grid.
- Each card shows workpath abbreviation + terminal id + live/idle indicator in its header strip.
- Clicking a card enters the zoomed view. Right-click preserves the current context menu.
- Card `×` destroys the terminal. If it was the last terminal in its workpath, the workpath pill's indicator and count clear but the pill stays (it is a saved bookmark).

### 4.3 Zoomed single-terminal view

Rendered when a card is clicked.

- Top breadcrumb row (replaces the global tab strip inside this view only):
  - `← Overview` link — returns to the grid for the current workpath.
  - Sibling chips — short id + live dot for every other terminal in the same workpath. Click swaps the zoomed terminal without leaving the view.
  - `⋯` opens the existing context menu (split vertical/horizontal, clear screen, close pane).
- Content area: current `SplitPaneContainer` unchanged. All split-pane shortcuts (`Ctrl+\\`, `Ctrl+Shift+\\`, `Ctrl+Shift+W`) continue to work against the zoomed terminal.
- `Esc` returns to Overview.

## 5. Selection semantics

| Click target | Action |
|---|---|
| `All` pill | Select `All`; show grid of every terminal across every workpath. |
| Workpath pill with ≥ 1 terminal | Select workpath; show its Overview grid. |
| Workpath pill with 0 terminals | Open a new terminal in that workpath (no startup command); select the workpath **and** zoom to the new terminal. |
| Quick-command chip (expanded state) | Open a new terminal in that workpath with the chip's command; select and zoom. |
| Card in grid | Enter zoomed view for that terminal. |
| Sibling chip in breadcrumb | Swap zoomed terminal to the sibling. |
| `+` at column bottom | Open directory picker to add a bookmark (no terminal created). |
| `+ New terminal` in grid info bar | New terminal in the current workpath (or directory picker when `All`); auto-zoom to it. |
| Card `×` / breadcrumb `⋯` → Close | Destroy that terminal. |

**Create-then-zoom rule.** Any action that creates a new terminal (empty pill click, quick-command chip, `+ New terminal`, `Cmd/Ctrl+T`) lands the user in the zoomed view for the new terminal. Rationale: the user just asked for a terminal, so put them in it.

## 6. Keyboard shortcuts

Additions:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+B` | Toggle left column forced-expanded state (independent of hover). |
| `Cmd/Ctrl+1…9` | Jump to Nth workpath in the column. `Cmd/Ctrl+1` is `All`. |
| `Cmd/Ctrl+T` | New terminal in current workpath. In `All`, open directory picker. |
| `Cmd/Ctrl+W` | Close current terminal inside zoomed view. No-op outside zoomed view. |

Preserved:

- `Ctrl+\\` / `Ctrl+Shift+\\` / `Ctrl+Shift+W` for split panes.

## 7. State machine (what lives in app state)

- `selectedWorkpathId: string | "all" | null` — drives left column selection and grid contents.
- `zoomedTerminalId: string | null` — null = Overview mode, set = zoomed mode.
- `columnForceExpanded: boolean` — from `Cmd/Ctrl+B`; independent of hover.
- Existing: terminals list, pane layouts per tab, active pane id, machine stats, control mode. These remain server-authoritative through the existing APIs.

Transitions to cover in the implementation plan:

- Terminal destroyed → if zoomed on it, fall back to the workpath's Overview; if it was last in workpath, `zoomedTerminalId = null`.
- Workpath bookmark deleted while selected → fall back to `All`.
- Selecting a workpath clears `zoomedTerminalId`.
- Creating a terminal from a workpath pill with 0 terminals selects the workpath **and** zooms to the new terminal.

## 8. Components to touch

Rough inventory. The implementation plan will refine this.

- `packages/app/components/Sidebar.tsx` — substantial rewrite. The current `MachineSection` / bookmark rendering becomes the expanded overlay; a new narrow `WorkpathRail` renders the collapsed state and the workpath pills.
- `packages/app/components/Canvas.web.tsx` — remove top-bar tab logic, add Overview info bar, change the grid filter from "all terminals" to "terminals in `selectedWorkpathId`".
- `packages/app/components/TitleBar.tsx` — no longer owns tabs. Either reduce to window chrome only or delete and inline its responsibilities where needed.
- New component: `TerminalBreadcrumb` for the zoomed-view top row (back link + sibling chips + `⋯`).
- Shortcut wiring: `Cmd/Ctrl+B/1-9/T/W` handled at the `Canvas` / app root level. Existing shortcut plumbing in `TerminalCanvas.web.tsx` extended.
- State: a small context or hook to expose `selectedWorkpathId`, `zoomedTerminalId`, `columnForceExpanded`.

Files that are **not** changing materially: `SplitPaneContainer.tsx`, `TerminalCard.web.tsx` internals (may need a slimmer header when rendered as a grid card), `TerminalView.*`, backend crates, shared protocol types.

## 9. Testing

- Unit tests for the state-machine transitions in §7, driven from a pure reducer if feasible.
- Component tests:
  - `WorkpathRail` collapsed rendering (abbreviations, live dots, counts).
  - Expanded overlay rendering (labels, paths, chips).
  - Overview grid filters by `selectedWorkpathId`.
  - Breadcrumb shows siblings, skips the zoomed terminal itself.
- Playwright smoke test for the full flow: open terminal → navigate back to Overview → switch workpath → zoom into a sibling.
- Existing resume-protocol and split-pane tests must keep passing untouched.

## 10. Risks

- **Abbreviation collisions** for bookmarks that share the first two letters. Mitigation: deterministic fallback to take letters further into the label; show full name on hover tooltip; user ultimately sees the full label in expanded state.
- **Overlay stealing hover** from widgets near the left edge. Mitigation: debounce expansion on enter, collapse on leave with a short grace period, and keep the hot zone limited to the 56 px rail.
- **Keyboard shortcut conflicts** with platform defaults (`Cmd+T` for new tab in browsers). Web build already traps these for the terminal app; confirm no regression.
- **Per-terminal switching is slightly slower** in the monitoring case (must zoom → chip → zoom). Acceptable because the common path is staying in Overview.

## 11. Decisions deferred to implementation

None blocking design. The plan will resolve:

- Whether the new state lives in an existing store or a new lightweight context.
- Whether `TitleBar.tsx` is kept as a thin window-chrome wrapper or merged into a parent component.
- Exact collision-resolution algorithm for workpath tag abbreviation.

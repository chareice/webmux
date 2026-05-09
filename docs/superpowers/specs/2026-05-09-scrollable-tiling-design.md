# Scrollable Tiling Workspace Design

## Goal

Add a per-group **scrollable tiling** layout mode (PaperWM / niri style) that arranges
panes as a one-dimensional horizontal strip of fixed-shape columns inside a scrolling
viewport. The mode coexists with the current binary-tree tiling and lets one
interaction model (left/right scroll = move viewport, tap/click = focus a column)
serve both desktop and mobile, removing the special-case "active pane fullscreen + tab
strip" mobile rendering.

## Goals & Non-Goals

**In scope**
- Per-group `layout_mode` toggle: `tiling` (current binary tree) or `scrollable`.
- One column = one pane. No nested splits inside a scrollable column.
- Column width as a preset (`half`, `two_thirds`, `full`) plus desktop drag-to-resize.
- Focus-driven viewport: changing focus auto-scrolls so the focused column is fully
  visible. Free scroll never changes focus.
- Lossless mode switching: `tiling → scrollable` flattens the tree (DFS leaf order)
  but persists the original tree so `scrollable → tiling` restores it.
- `split-down` while scrollable: remap to "append a new column to the strip".
- New columns: appended to the end of the strip.
- New groups default to `scrollable`. Existing groups (no stored mode) keep `tiling`.
- Toggle UI: group-tab context / long-press menu plus a desktop toolbar icon.

**Out of scope**
- Column-internal vertical splits (niri-style).
- Multi-viewport (two visible viewports side-by-side).
- Cross-group pane drag.
- Reflowing or merging columns automatically.

## Behavior

### Layout

- A scrollable group's layout is an ordered list of column entries.
  Each column has one terminal id and a width descriptor.
- Width descriptor: `{ kind: "preset", value: "half" | "two_thirds" | "full" }` or
  `{ kind: "fraction", value: 0.05..1 }` (continuous, used by desktop drag).
- Mobile (viewport width < `MOBILE_WIDTH_THRESHOLD`, reuse the existing breakpoint
  used by `MobileWorkbench`) treats every column as `full`. The stored width is kept,
  it just is not used while the viewport is mobile-sized.

### Focus and scrolling

- The workspace tracks `activeTerminalId` exactly as today. In a scrollable group the
  focused terminal is the focused column.
- When focus changes (click, keyboard `paneLeft` / `paneRight`, programmatic), the
  viewport scrolls so the focused column is fully inside the viewport with a small
  inset (CSS `scroll-padding-inline`).
- Free scrolling (wheel, trackpad two-finger, touch swipe) moves the viewport but
  does not change focus.
- `paneUp` / `paneDown` shortcuts in scrollable mode are no-ops (no vertical
  neighbors to focus).

### Width and resizing

- Default new column width: `half` on desktop, treated as `full` on mobile.
- Keyboard cycles presets on the focused column: `Mod+,` → smaller, `Mod+.` → larger.
  Cycle order: `half ↔ two_thirds ↔ full`.
- Desktop drag handle between columns sets `kind: "fraction"`. Persisted as
  fraction; presets only re-apply when the user keys a preset shortcut.
- Mobile never shows drag handles.

### Mode switching

- `tiling → scrollable`: walk the saved binary tree DFS (`first` then `second`),
  each leaf becomes a column in order. Column widths default to `half`.
  The original tree is preserved verbatim under `tiling_layout` so a return
  is lossless. Columns added while in scrollable mode are not merged back into
  the tree on switch-back; they are appended as the rightmost element of the
  restored tree (right-only horizontal split).
- `scrollable → tiling`: restore `tiling_layout` if present, else build a left-leaning
  horizontal-split tree from the column list. Append any extra panes to the right.
- `split-down` (and any other non-right split intent) while in scrollable mode is
  remapped to "append a new column at the end of the strip" with default width.
  `split-right` is also "append at end of strip" — same action in this mode.

### New groups

- Newly created `workspace_groups` get `layout_mode = "scrollable"`.
- Existing rows have `layout_mode IS NULL`, treated as `tiling` for backward
  compatibility.
- Transient cwd-based groups (no `workspace_groups` row) are always `tiling` until
  the user promotes them. A future change can default cwd groups to scrollable;
  this design leaves them as `tiling` to avoid changing existing behavior on first
  deploy.

### UI entry points

- Group tab right-click on desktop / long-press on mobile menu gains a
  "Layout: Tiling / Scrollable" toggle.
- Desktop workspace toolbar adds a small mode-toggle icon next to the existing
  split / fit / maximize buttons.
- The toggle is disabled (greyed) for transient cwd groups until the user
  saves them as a persistent group.

## Data Model

- `workspace_groups.layout_mode TEXT NULL`: `"tiling"` or `"scrollable"`.
  `NULL` means legacy / `tiling`.
- `workspace_layouts` keeps the existing `root_json` for the active mode plus a
  new `aux_json TEXT NULL` column holding the inactive mode's layout (used to
  preserve the tiling tree while scrollable is active and vice-versa).
- TS shared types in `packages/shared/src/contracts.ts`:
  - `WorkspaceLayoutMode = "tiling" | "scrollable"`.
  - `WorkspaceColumnWidth =
      | { kind: "preset"; value: "half" | "two_thirds" | "full" }
      | { kind: "fraction"; value: number }`.
  - `WorkspaceScrollableLayout = { columns: { terminal_id: string; width: WorkspaceColumnWidth }[] }`.
  - Extend `WorkspaceLayoutInfo` with optional `mode: WorkspaceLayoutMode` and
    `scrollable: WorkspaceScrollableLayout | null`. The existing `root` stays as
    the tiling representation.
- Rust mirror types in `crates/protocol` (serde-tagged unions match the TS shape).
- DB migration adds the two new columns. Old rows read as `mode = "tiling"`,
  `scrollable = null`.

## TS Layout Engine

- `packages/app/lib/terminalWorkspaceLayout.ts` gains a parallel "scrollable" code
  path. The exported pure functions stay intent-based and decide internally which
  representation to mutate based on the active group's `layout_mode`:
  `splitWorkspacePane`, `appendWorkspacePaneToGroup`, `closeWorkspacePane`,
  `swapWorkspacePanes`, `findAdjacentWorkspacePane`,
  `reconcileTerminalWorkspace`.
- New helpers:
  - `setWorkspaceLayoutMode(workspace, groupId, mode)`.
  - `setWorkspaceColumnWidth(workspace, terminalId, width)`.
  - `cycleWorkspaceColumnWidth(workspace, terminalId, direction)`.
  - `flattenTreeToColumns(root) -> Column[]`.
  - `buildTreeFromColumns(columns) -> WorkspacePaneNode | null`.

## Rendering

- `packages/app/components/TerminalWorkspace.web.tsx`: introduce
  `ScrollableWorkspace` alongside `WorkspacePaneTree`. The top-level group renderer
  picks one based on the group's `layout_mode`.
- `ScrollableWorkspace`:
  - Outer element: `overflow-x: auto; scroll-snap-type: x proximity` with a
    `scroll-padding-inline` matching the gutter.
  - Each column wraps `WorkspacePaneLeaf` and applies a flex-basis from the
    width descriptor (clamped to viewport on mobile).
  - On focus change, calls `element.scrollIntoView({ inline: "nearest", block: "nearest" })`
    on the focused column.
  - Drag handles between columns on desktop only. Reuses the existing pane-drag
    infrastructure for column reordering.
- The mobile-only branch (`isMobile` block in `TerminalWorkspace.web.tsx`) stays
  for `tiling` groups (kept as-is to avoid regressions). A `scrollable` group on
  mobile renders the same `ScrollableWorkspace` — the viewport is just narrow.

## Keyboard

- `paneLeft` / `paneRight`: move focus to the previous / next column. Wraps at the
  ends or stops; we keep the existing tiling behavior (no wrap).
- `paneUp` / `paneDown`: no-op in scrollable mode.
- New shortcuts (added to `workspaceShortcuts.ts`):
  - `columnWidthShrink` default `Mod+Comma`.
  - `columnWidthGrow` default `Mod+Period`.
  - `layoutModeToggle` default `Mod+Alt+T`.

## Persistence

- Frontend persists scrollable layout updates through the existing
  `update_workspace_layout` request, sending the new fields.
- Server upserts `workspace_layouts` row including `mode`, `root_json`, `aux_json`.
- The browser snapshot includes layouts with mode + both representations so the
  client can render immediately on load.

## Testing

- Unit tests for the new layout helpers (split, append, close, swap, focus
  navigation, mode flatten / restore round-trip, width cycling).
- Component test for `ScrollableWorkspace`: focused column always scrolls into
  view, mobile width forces full-width columns, drag handle updates width state,
  reordering columns updates the strip.
- Rust DB test for the migration: legacy rows read back as `tiling`; round-trip
  preserves `aux_json`.
- Existing tiling tests must keep passing.

## Risks & Open Questions

- Existing groups stay in `tiling` on first deploy. We accept that "scrollable"
  becomes opt-in for legacy groups — this is intentional to avoid changing UX
  for users who rely on 2D layouts.
- Touch interaction on iOS Safari sometimes fights with `scroll-snap-type:
  proximity` on `overflow-x` containers. We use `proximity` (not `mandatory`)
  to avoid stuck-snap; if it still fights, fall back to no snap.
- Drag-to-resize between columns is desktop-only. Mobile users get presets only
  via long-press or shortcut; that is acceptable for v1.

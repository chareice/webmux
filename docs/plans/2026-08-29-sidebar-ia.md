# Desktop Sidebar IA — Implementation Spec

Date: 2026-08-29. Branch: `feat-sidebar-ia`. Scope: **frontend only** (`packages/app`), desktop (`!isCompact`) only. Mobile (`MobileWorkbench`) is untouched. Do not touch `crates/*` (a parallel branch is adding agent sessions to the backend; this PR is terminals-only — no chat UI yet).

## Goal

Replace the desktop top TabBar IA with a Claude-Desktop-style **left sidebar**: hosts status bar on top, a project → session tree in the middle, control/user area at the bottom. The right side stays the existing `TerminalWorkspace` (tab = group of split panes, unchanged behavior).

**Design reference (authoritative)**: `docs/design/next-ia/Main.dc.html`, `Terminal.dc.html`, `Split.dc.html`, `States.dc.html` — open and read them; they use the repo's real tokens from `main` branch `DESIGN.md` / `packages/app/global.css`. Ignore everything chat-related in them (chat view, amber asked-state, unread dots, inbox, auto-run labels, PROD badge) — that ships in a later PR. What you implement now: the sidebar shell, hosts bar, project/session tree for terminals, bottom control area, and the layout swap.

## Key IA decisions (settled product decisions — do not deviate)

1. **Machine is a qualifier, not a mode.** Today `activeMachineId` scopes the whole desktop UI to one machine (`HostSwitcher` switches). New model: the tree shows **all machines' groups at once**, grouped/labelled by machine; clicking a host in the hosts bar toggles a **filter** (dim/hide other machines' sections), not a mode switch. All data is already global in `browserState` (terminals/groups/layouts carry `machine_id`) — this is a re-projection, not a data change.
2. **Sidebar tree**: section header = workspace group ("project"), rows = the group's pane terminals (title via `displayTerminalTitle`, dot = reachable state; dashed/dim when unreachable). Sections ordered per machine by existing `sort_order`; machine name as a small divider label above its sections. Tree does **not** re-sort by status.
3. Section header interactions: click selects the group (right side shows its panes via existing workspace `selectGroup`); context menu = rename / delete / new terminal here (reuse existing handlers); `+` on hover; drag to reorder within a machine (reuse the TabBar drag logic or simplify to context-menu "move up/down" if drag is too entangled — note which you chose).
4. Row click: select that group **and** focus that pane. Add a `focusPane(terminalId)` command to `WorkspaceCommandChannel` (TerminalWorkspace already tracks focused pane internally — expose it). Double-click or a context action may zoom (existing `ZOOM_TERMINAL` / `#/t/` route unchanged).
5. **Bottom area**: control-lease pill (Control / viewing / view only — same three states and actions as today's TabBar right side), settings gear, sign out. Host CPU/MEM/RTT meters live in the hosts bar rows (reuse the existing meter/pill components from `TabBar.web.tsx` — extract, don't duplicate).
6. Sidebar width ~240–260px fixed (match the canvas), full height, left of `<main>`; `AppTitleBar` stays on top of everything as-is.
7. The top `TabBar` disappears on desktop. Keep the file (mobile does not use it, but the palette/shortcut plumbing may import helpers) — delete only what becomes dead, and check `knip`/imports if configured; otherwise leave exports used elsewhere.
8. Shortcuts/palette must keep working: `⌃B 1..9` select the Nth section in the tree (across machines, top-to-bottom), palette "tabs" rows unchanged, `⌃B s` host filter rows now toggle filters. `workspaceCommandsRef` plumbing in `TerminalCanvas.web.tsx` stays the single command channel.

## Where things live today (read first)

- `packages/app/components/TerminalCanvas.web.tsx` — owns all state you need: `browserState` (machines/terminals/groups/layouts/stats/leases), `tabGroups` (via `createTerminalWorkspace`), handlers for create/destroy/rename/delete/reorder, `workspaceCommandsRef`, prefix-key engine, palette. The desktop render branch is at the bottom (`<TabBar …/><TerminalWorkspace …/>`).
- `packages/app/components/TabBar.web.tsx` — the component being replaced; contains the host switcher, stats meters, control pill, tab context menu + drag. Mine it for reusable pieces.
- `packages/app/components/TerminalWorkspace.web.tsx` — right-side workspace; exposes `WorkspaceCommandChannel` (`selectGroup`, `reorderGroups`, `runPrefixAction`); you add `focusPane`.
- `packages/app/lib/terminalWorkspaceLayout.ts` — `createTerminalWorkspace`, `WorkspaceGroup` model, `collectGroupPaneTerminalIds`.
- Caveat: since PR #284 every terminal gets an auto-created group named after its cwd (`auto_created`), so many sections will have a single row — that's expected; do NOT merge groups client-side in this PR.

## Multi-machine mechanics

- Compute `tabGroups` per machine (the existing `createTerminalWorkspace` call, once per machine) and render machine-by-machine. `TerminalWorkspace` remains scoped to one machine at a time (it takes `terminal` + `siblings`); selecting a section on another machine sets `activeMachineId` first, then `selectGroup` — selection must be robust across that transition (the workspace remounts; use the same pending-selection pattern that `pendingGroupSelectionRef` uses for new groups, or extend it).
- Host filter state is UI-only (component state or `mainLayoutReducer`), default "all visible".
- Hosts bar rows: name, online dot, cpu/mem meters, rtt — data from `machineStats` + `rttMs` (rtt is hub-wide today; show it once in the bar header, not per host).

## Testing / acceptance

- `pnpm typecheck`, `pnpm test` (vitest), `pnpm build` all clean.
- Unit tests: extract the tree-building projection (machines+groups+terminals → ordered sidebar model incl. `⌃B N` index assignment and host filtering) into a pure lib function `lib/sidebarTree.ts` with vitest coverage. Test focusPane command plumbing at the reducer/channel level where feasible.
- **Playwright e2e** (`e2e/*.spec.ts`): the suite drives the desktop UI via TabBar testids and will break. Update the specs to the sidebar equivalents: give sidebar stable testids (`sidebar-host-<id>`, `sidebar-section-<groupId>`, `sidebar-row-<terminalId>`, `sidebar-control-pill`, …) and rewrite selectors/assertions to preserve each spec's *semantic* (create tab, rename, delete with confirm, reorder, select, control handoff…). You cannot run docker e2e in this environment — get them right by reading; the human will run `pnpm e2e:test` afterwards and feed back failures.
- Do not change mobile specs or `MobileWorkbench`.

## Constraints

- Follow existing code style: inline style objects + `colors` from `@/lib/colors`, no new styling libs, `data-testid` conventions as in TabBar.
- No new dependencies.
- Keep the diff reviewable: new files `Sidebar.web.tsx`, `lib/sidebarTree.ts` (+ tests); surgical edits to `TerminalCanvas.web.tsx`, `TerminalWorkspace.web.tsx`; e2e spec updates.
- Commit in logical chunks. When done, write `docs/plans/2026-08-29-sidebar-ia-REPORT.md`: what was built, real test output, which e2e specs you touched and why, deviations from spec, known risks for the human's docker e2e run.

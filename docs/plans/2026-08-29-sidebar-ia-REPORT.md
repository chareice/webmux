# Desktop Sidebar IA — Implementation Report

Date: 2026-08-29. Branch: `feat-sidebar-ia`. Spec: `docs/plans/2026-08-29-sidebar-ia.md`.

## What was built

- **`packages/app/lib/sidebarTree.ts`** (new): pure projection `buildSidebarTree(machines, terminals, workspaceGroups, workspaceLayouts, …)` → ordered sidebar model. Machines in `browserState` order; sections per machine via the existing `createTerminalWorkspace` (persistent groups by `sort_order`, then cwd fallbacks — no status re-sort); rows are the group's pane terminals with `displayTerminalTitle` + `reachable`; `shortcutIndex` (⌃B 1..9) is assigned across machines top-to-bottom over the sections left visible by the host filter; `dimmed` flags filtered-out machines.
- **`packages/app/lib/terminalWorkspaceLayout.ts`**: added pure `focusWorkspacePane(workspace, terminalId)` (select containing group + focus pane; `null` when the terminal isn't in any group yet).
- **`packages/app/components/Sidebar.web.tsx`** (new): 260px fixed column, full height, left of `<main>`; `AppTitleBar` untouched above. Brand row (logo + `sidebar-new-tab` ＋), hosts rail (`sidebar-host-<id>` rows with online dot + cpu/mem/disk meters extracted from TabBar's `MicroMeters`/`Meter`, hub-wide RTT once in the rail header as `sidebar-rtt`, add-host ＋ as `sidebar-add-host`), the session tree (machine divider labels `sidebar-machine-<id>`, section headers `sidebar-section-<groupId>` with hover ＋ `sidebar-section-new-<groupId>`, context menu = New terminal here / Rename tab / Delete tab, grip `sidebar-section-drag-<groupId>`, rows `sidebar-row-<terminalId>` with filled/dashed reachability dot), and the bottom control area (`sidebar-control-pill` for viewing / 🔒 view only, `sidebar-view-only-lock` while controller, `sidebar-settings`, `sidebar-sign-out`).
- **`packages/app/components/TerminalWorkspace.web.tsx`**: `WorkspaceCommandChannel` gains `focusPane(terminalId)` (uses `focusWorkspacePane`; parks the command in `pendingPaneFocusRef` and flushes after reconcile when the pane isn't in state yet — the same pending pattern as `pendingGroupSelectionRef`); new `onActiveTerminalChange` prop mirrors the focused pane to the canvas; `selectTab1..9` removed (moved to the canvas).
- **`packages/app/components/TerminalCanvas.web.tsx`**: desktop branch renders `<Sidebar/>` + `<main>`; `hostFilterId` UI state (default all visible, cleared when the machine vanishes); `selectSidebarTarget` parks cross-machine selections in `pendingSidebarSelectionRef` and replays them once `activeMachineId` lands; ⌃B 1..9 select the Nth visible tree section across machines; palette "tabs" rows mirror the tree (all machines, ⌃B N hints follow tree order, off-machine labels prefixed with the machine name); palette "hosts" rows now toggle the host filter (they list all machines, not just "other online" ones); rename/delete/new-terminal-here are per-machine (`performRenameGroup`/`performDeleteGroup`/`handleNewTerminalInSection` take a machineId; a full target overflows into a fresh `tab N` on that machine).
- **Deleted**: `TabBar.web.tsx`, `HostSwitcher.web.tsx` — both became fully dead (nothing else imported them; no knip configured). Meters/pill styles were extracted into the sidebar, not duplicated.

## Reorder choice

Kept drag-to-reorder: the TabBar mouse-drag protocol ported to vertical (4px arm threshold, `elementFromPoint` drop on `[data-workspace-group-drop-id]`, placement from the pointer's Y vs the target's vertical midpoint). Drags only apply between sections of the **active** machine — the reorder command channel is scoped to the mounted workspace.

## Test output (real)

```
$ pnpm typecheck
> tsc -b          # clean, no output

$ pnpm test
Test Files  36 passed (36)
     Tests  277 passed (277)

$ pnpm build      # expo export --platform web
Exported: dist    # success

$ npx playwright test --list
Total: 69 tests in 21 files   # all specs parse
```

New unit coverage: `lib/sidebarTree.test.ts` (7 tests: per-machine ordering, persistent-before-fallback without status re-sort, row titles/reachability, cross-machine ⌃B N assignment capped at 9, host-filter dimming + index reassignment, active/focused flags only on the active machine, online rule) and `focusWorkspacePane` cases in `lib/terminalWorkspaceLayout.test.ts`.

## E2E specs touched and why

- `e2e/tests/helpers.ts` — `openApp` waits for `sidebar`; control affordance is `sidebar-control-pill` (viewing / view only) vs `sidebar-view-only-lock` (controlling); `expectControlState("controlling")` now positively asserts the lock is visible.
- `e2e/tests/workspace-tabs.spec.ts` — testid swap (`workspace-group-*`/`workspace-tab-*`/`tab-bar-new-group` → `sidebar-section-*`/`sidebar-new-tab`); drag helper drops by vertical midpoint; the hover-to-select test became click-to-select (sidebar has no hover selection — spec point 3); the create+delete context-menu test creates via the brand-row ＋ because the section menu now offers "New terminal here" instead of "New tab"; the meters test targets `sidebar-host-e2e-node-meter-{cpu,mem,disk}`.
- `e2e/tests/core-control-flow.spec.ts` — `sidebar` waits, `sidebar-new-tab` gating.
- `e2e/tests/workspace-panes.spec.ts` — `sidebar` waits (2×).
- `e2e/tests/multi-device-collaboration.spec.ts` — handoff reuses `takeControlFromHeader` (sidebar pill).
- `e2e/tests/terminal-handoff-sizing.spec.ts` — pill testid.
- `e2e/tests/add-machine-entrypoint.spec.ts` — HostSwitcher dropdown is gone; entry point is the hosts-rail ＋.
- `e2e/tests/fold-layout.spec.ts` — asserts `sidebar` (not the deleted `tab-bar`) is absent on mobile layouts, keeping the assertion non-vacuous.
- `e2e/specs/*.md` (core-control-flow, grid-navigation, multi-device-collaboration, terminal-handoff-sizing) — prose updated to the sidebar IA.

Mobile specs and `MobileWorkbench` untouched.

## Deviations from spec

1. Host filter **dims** (opacity 0.45) other machines' sections instead of hiding them — the spec allowed "dim/hide"; dimming keeps the tree DOM stable for e2e and makes the filter obviously reversible.
2. Host-row meters keep the numeric percentages from the extracted TabBar `Meter` (the canvas shows bars only) — spec said extract, don't duplicate.
3. Bottom area has no user avatar/name row (no user data exists in `browserState`/`useAuth`); it is control pill + settings + sign out.
4. No "offline 4m · reconnecting" line in host rows — no offline-duration data source exists yet.
5. Row double-click zoom is a no-op addition: row click already drives `ZOOM_TERMINAL` + `#/t/` through `activateTerminal` → `onPick`, so no separate dblclick handler was added. Pane-maximize zoom stays on ⌃B z / the pane context menu.
6. Palette host rows list **all** machines (previously "other online machines") because they now toggle filters rather than switch to a machine.

## Known risks for the human's docker e2e run

- I could not run `pnpm e2e:test` here (no docker). Validated by reading, `playwright test --list`, typecheck, unit tests, and build only.
- Section headers are `div`s (they contain the ＋ button and grip); specs scope locators as `div[data-testid^='sidebar-section-']`. If a spec regresses on visibility/click, check this first.
- The vertical drag protocol (28px section headers, Y-midpoint placement, `elementFromPoint`) mirrors the proven horizontal one but is new; slow-runner flakes would most likely surface in the three reorder tests in `workspace-tabs.spec.ts`.
- `expectControlState("controlling")` is stricter than before (requires the lock button); any place that renders the canvas without the sidebar (none known) would fail it.
- Cross-machine behavior (host filter dimming, cross-machine section/row selection, cross-machine new-terminal) is covered only by unit tests on the projection — e2e runs a single node (`e2e-node`), so these paths have no browser coverage.

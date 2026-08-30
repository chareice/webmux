# Tab keep-alive — execution report

Spec: `docs/plans/2026-08-30-tab-keepalive-spec.md`

## Progress log

- Started: reading `TerminalWorkspace.web.tsx` and `terminalWorkspaceLayout.ts`
  to map the current group-switch render path.
- Added pure `mountedWorkspaceGroupIds(workspace, previousActiveGroupId, isTouch)`
  to `packages/app/lib/terminalWorkspaceLayout.ts` (cap 2 desktop / cap 1 touch,
  dedupe, filters ids no longer in `workspace.groups`).
- Vitest coverage added in `terminalWorkspaceLayout.test.ts` (activation order,
  dedupe, deleted-group filtering, missing active id, isTouch cap):
  52/52 pass in that file.
- Implemented keep-alive in `TerminalWorkspace.web.tsx`: render-time LRU ref
  (previous active group), stacked wrapper divs (absolute inset:0, active
  first in DOM order, hidden group gets visibility:hidden + pointerEvents:none
  + zIndex 0), hidden tree renders with activeTerminalId/maximizedTerminalId/
  fitRequest = null.
- `pnpm typecheck`, `pnpm test` (332 pass), `pnpm build`: all green.
- Updated two assertions in `e2e/tests/workspace-tabs.spec.ts` that assumed
  unmount-on-switch (`toHaveCount(0)` → `toBeHidden()`, with comment) — the
  switched-away pane now intentionally stays mounted but hidden.
- Wrote `e2e/tests/workspace-keepalive.spec.ts`: init-script WebSocket wrap
  counting `/ws/terminal/` constructions per URL + per-socket input log;
  marker/via-buffer reads through `__webmuxTerminals`; covers instant
  switch-back, no WS re-attach, hidden-group input isolation, and the cap-1
  eviction re-attach.
- Starting e2e: rebuilding hub/node images.
- E2E run 1 (`tests/workspace-keepalive.spec.ts` in runner container): keepalive
  half passed (instant switch-back, no WS re-attach, hidden-group input
  isolation), eviction assertion failed: A's WS count stayed 1. Root cause is
  in the SPEC, not product code: the LRU keeps [active, previous], so after
  activating C the mounted set is [C, A] — A is still kept alive. Evicting A
  requires one more switch. Fixed the spec: after C, switch to B (mounted
  [B, C], assert A's pane fully unmounted via toHaveCount(0)), then back to A
  and assert WS count increased.
- Rerun 1 used the stale runner image (tests are baked in via `COPY e2e e2e`
  in `e2e/Dockerfile.runner` — no volume mount), same failure. Rebuilt runner
  image, rerun 2: `workspace-keepalive.spec.ts` PASSED (3.5s) — instant
  switch-back, no WS re-attach, hidden-group input isolation, and cap-1
  eviction re-attach all verified in the container browser.
- Running regression specs that touch group switching: workspace-tabs,
  workspace-panes, terminal-fit-stability, mobile-controls.
- Regression batch 1 (keepalive + workspace-tabs + workspace-panes +
  terminal-fit-stability + mobile-controls, runner image rebuilt): 43/44
  passed. Failure: `workspace-panes.spec.ts:142` assumed unmount-on-switch
  (expected 1 pane element, got 5 — kept-alive group's panes still mounted).
  Fixed the assertion to count only `:visible` panes (same class of fix as
  the earlier workspace-tabs ones).
- `workspace-panes.spec.ts` alone after fix: 7/7 passed.
- Regression batch 2 (all 5 specs): 44/45 — NEW failure in
  `workspace-panes.spec.ts:278` (prefix focus): strict-mode violation,
  `workspace-pane-<id>` resolved to 2 elements (one visible with box-shadow,
  one without). Reproduced 1/6 in isolation, then 3/15 + 2/15 with a temp
  debug spec (`zz-dup-debug.spec.ts`) + temp `__webmuxWorkspace` window hook.
- Root cause (product bug exposed by keep-alive): a terminal mid-move sits in
  TWO groups' trees transiently — `handleSplit`'s optimistic
  `splitWorkspacePane` inserts the new terminal into the source group while a
  reconcile already placed it in the cwd-fallback group (terminal_created
  arrives while the workspaceGroups prop is stale). Pre-keep-alive only the
  active group rendered, so the stale copy was invisible. With keep-alive the
  previous group stays mounted and BOTH trees mount a WorkspacePaneLeaf for
  the same terminal — two xterm + WS instances. Debug dump confirmed: visible
  copy in active group's split tree, hidden full-width copy in `cwd:/root`.
- Fix: hidden group's `WorkspacePaneTree` gets a `terminalsById` filtered to
  exclude panes claimed by the active group's tree (`activePaneIds`), so a
  transiently duplicated terminal never mounts twice; the next reconcile
  cleans the state. `pnpm typecheck` + `pnpm test` (332) green.
- Dup-fix verified: debug repro spec 15/15 clean (was 3/15 failing). Removed
  the temp debug spec and `__webmuxWorkspace` hook; `pnpm typecheck`,
  `pnpm test` (332), `pnpm build` green after removal.
- Final batch (keepalive + workspace-tabs + workspace-panes +
  terminal-fit-stability + mobile-controls, fresh hub/runner images): first
  run 43/45 — `workspace-tabs:18` strict-mode violation from a transient
  duplicate SIDEBAR section (`cwd:/tmp` fallback alongside the persistent
  "tmp" tab while its group row is in flight; sidebar/group derivation is
  untouched by this branch — load-dependent transient) and
  `mobile-controls:218` touch-scroll timeout (mobile path, keep-alive is
  disabled under isTouch). Both specs rerun in isolation: workspace-tabs
  19/19, mobile-controls 14/14. Full batch rerun: 45/45 passed.
- Result: keepalive e2e green (instant switch-back with no WS re-attach,
  hidden-group input isolation, cap-1 eviction re-attach), all
  group-switching regression specs green, plus one real product fix
  (duplicate pane mount guard) and two spec assertion updates for the new
  intentional mounted-but-hidden behavior.

KEEPALIVE COMPLETE

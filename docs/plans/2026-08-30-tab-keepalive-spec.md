# Perf: workspace group keep-alive (instant tab switching)

Goal: switching workspace groups currently unmounts the whole pane tree and
remounts the next one — every pane rebuilds xterm + WS + tmux attach, which
takes visibly long. Keep the most recently used inactive group mounted but
hidden so flipping back is instant.

## Current behavior (verified)

`packages/app/components/TerminalWorkspace.web.tsx` renders only
`activeGroup.root` through `WorkspacePaneTree` (~line 979). Switching groups
swaps the whole tree; pane keys are terminalIds of a different group, so all
leaves unmount. `WorkspacePaneTree` (~line 1075) flattens panes to an
absolutely-positioned list keyed by terminalId (PR #289).

## Design (v1, deliberately small)

Keep **at most one** inactive group mounted — the previously active one
(covers the dominant A↔B flip). Desktop only: **skip keep-alive entirely when
`isTouch` is true** (mobile WebView memory).

Rationale for the cap: each live pane holds a WebGL context; browsers cap
contexts at ~8-16 and evict the oldest on overflow. Active(≤4) + one hidden
group(≤4) stays ≤8, so NO gpu-suspend machinery is needed in v1. Do not add
any.

### Implementation

In `TerminalWorkspace.web.tsx`:

1. Track `mountedGroupIds`: ordered list, `[activeGroupId, previousActiveGroupId]`,
   deduped, filtered to groups that still exist in `workspace.groups`, capped
   at 2 (cap 1 / no keep-alive when `isTouch`). Extract the list computation
   as a small pure function (e.g. in `terminalWorkspaceLayout.ts` next to
   `flattenWorkspacePanes`) with vitest coverage: activation order, dedupe,
   deleted-group filtering, isTouch cap.
2. Render every mounted group's `WorkspacePaneTree` inside a wrapper div
   (`key={group.id}`, `position:absolute; inset:0`). The non-active wrapper
   gets `visibility:hidden; pointerEvents:"none"` (NOT `display:none` —
   layout must keep running so ResizeObserver/fit stay correct while hidden)
   plus `zIndex:0` vs `zIndex:1` for the active one.
3. Hidden group's tree renders with `activeTerminalId={null}` and
   `maximizedTerminalId={null}` — no leaf may be `isActive` (two active
   leaves race focus/onActiveRef; see the zoom comment at ~line 1154). Pass
   `fitRequest` only to the active group's tree.
4. Group switch: update the LRU, nothing else. The newly visible group's
   terminals are already attached and current (tmux streamed all along).
   Keep today's semantic that zoom (maximized) state does not survive a
   group switch.
5. Group deletion / terminal destroy paths must not special-case anything:
   the LRU filter against existing groups handles it (add a vitest case).

### Explicitly out of scope

- No throttling of hidden-group output streams (bounded: one group).
- No mux / shared WS. Hidden panes keep their per-terminal WS.
- No mobile keep-alive.
- Do not touch `MobileWorkbench` or the `isTouch` stacking logic beyond the
  cap in (1).

## Verification

1. `pnpm test`, `pnpm typecheck`, `pnpm build` — all green.
2. New e2e spec `e2e/tests/workspace-keepalive.spec.ts` (desktop viewport),
   conventions from existing workspace specs:
   - Init-script wrap `window.WebSocket` to count constructions per URL
     (reuse the `__wsInputLog` wrapping pattern from
     `mobile-ime-composition.spec.ts`, but count `/ws/terminal/` opens).
   - Create two groups with one terminal each (see how existing specs create
     groups — grep `workspace` under e2e/tests). In group A run
     `echo KEEPALIVE_MARKER_A`; switch to group B; run `echo MARKER_B`;
     switch back to A.
   - Assert: (a) A's screen still shows `KEEPALIVE_MARKER_A` immediately
     (buffer API `__webmuxTerminals`, translateToString — never `.xterm-rows`);
     (b) the terminal-WS construction count for A's terminal did NOT increase
     on the switch-back (kept alive, not re-attached);
   - Then create a third group C, activate C, and assert A's WS count DID
     increase after switching back to A (evicted → remounted) — proves the
     cap works.
   - While B is hidden: assert typing into the page does NOT reach B
     (`__wsInputLog` for B's socket stays empty while A is active).
3. Run e2e per the documented flow (rebuild hub image for frontend changes):
   `docker compose -f e2e/docker-compose.yml up --build -d hub node` then
   `docker compose -f e2e/docker-compose.yml run --rm runner npx playwright
   test tests/workspace-keepalive.spec.ts`. Then run the existing
   workspace/terminal specs that touch group switching (grep for specs using
   groups) to catch regressions. Note: `workspace-tabs` has a KNOWN
   pre-existing high-load flake (active group flips back after a click,
   "element was detached" loop) — if you hit exactly that pattern, rerun the
   spec in isolation before concluding anything; do not chase it.

## Constraints

- Match surrounding code style; comments state constraints, not narration.
- Don't refactor beyond the spec.
- Write progress + results incrementally to
  `docs/plans/2026-08-30-tab-keepalive-REPORT.md` (stdout may be lost).
- Do not commit. When fully done append `KEEPALIVE COMPLETE` to the report.

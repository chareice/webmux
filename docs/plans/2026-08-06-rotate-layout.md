# Rotate workspace layout (⌃B r)

**Status:** implementation spec (2026-08-06), adapts the parked 2026-05 design (`docs/superpowers/specs/2026-05-26-rotate-workspace-layout-design.md`) to the current tab=group architecture.

**User story:** a group whose panes ended up stacked top↔bottom can be flipped to side-by-side (and back) without closing/recreating panes.

## Behavior

- New rebindable prefix action `rotateLayout` (label "Rotate layout"), **default binding `r`** (verified free in `DEFAULT_PREFIX_BINDINGS` — used keys: 1-9,n,p,w,%," ,arrows,z,x,[,s,k,?,c).
- Applies to the ACTIVE group of the active machine, only when the user **is controller** for that machine AND the group has **≥2 panes**. Otherwise a no-op (and the UI affordances show disabled, reusing the same enablement state as the existing split commands).
- Every split node in the group's layout tree flips direction (`Horizontal` ↔ `Vertical` — protocol `WorkspaceSplitDirection`). **Leaf order, split ratios, and first/second structure stay unchanged.** Active terminal stays active.
- After rotation: refit every pane in the group via the existing `requestPaneFit(collectIds(...))` path (same call sites as split), then persist via the existing `persistGroupLayout` path.

## Implementation

1. **`packages/app/lib/terminalWorkspaceLayout.ts`** — pure helper `rotateWorkspaceLayout(workspace: TerminalWorkspace): TerminalWorkspace`: flips every split direction in the ACTIVE group's root tree (recursive map; leaves untouched; ratios preserved; `paneCount` recomputed as in `swapWorkspacePanes`). No-op for missing/≤1-pane roots.
2. **`packages/app/lib/prefixKey.ts`** — add `"rotateLayout"` to the `PrefixActionId` union, default binding `r`, and the definitions list entry (label "Rotate layout"). Check the cheat-sheet test expectations if any enumerate actions.
3. **`packages/app/components/TerminalWorkspace.web.tsx`** — wire `rotateLayout` in the prefix-action map (next to `splitRight`/`splitDown` at ~line 643): guard `isController`, call the helper via `updateWorkspace`, `requestPaneFit(collectIds(...))`, `persistGroupLayout`. Add it to the context menu where the splits live (~line 784) with `shortcut: formatPrefixBinding("rotateLayout")`.
4. **`packages/app/components/TerminalCanvas.web.tsx`** — add the palette row next to `split-right`/`split-down` (id `rotate-layout`, label "Rotate layout", same section) dispatching `runPrefixAction?.("rotateLayout")` with the same disabled logic the split rows use.

## Tests

- `terminalWorkspaceLayout.test.ts`: (a) two-pane vertical → horizontal (direction flipped, order/ratio preserved); (b) nested tree — every split flips, leaf terminal order + ratios + first/second preserved; (c) ≤1 pane no-op; (d) inactive group untouched, active terminal preserved.
- Prefix bindings: update any test enumerating defaults/definitions.
- **e2e** (`e2e/tests/workspace-panes.spec.ts`): extend — after splitting (existing flow at line 17), rotate via the palette and assert the layout renders side-by-side (assert via pane bounding boxes: same y-band, disjoint x-bands — the file already reads pane geometry for fit checks; follow its helpers). Then rotate again and assert stacked. Watch for the same volatile-field pitfalls as the sizing specs (assert geometry, not volatile metadata).

## Engineering requirements

- Follow existing code style; no new deps; no backend changes (layout persistence rides the existing save path).
- `pnpm typecheck` and `pnpm vitest run` green; `cargo check --workspace` untouched-green.
- e2e: use the container runner — `sudo -E env "PATH=$PATH" docker compose -f e2e/docker-compose.yml up -d --build hub node` then `sudo -E env "PATH=$PATH" docker compose -f e2e/docker-compose.yml run --rm runner npx playwright test workspace-panes` (must pass; then `docker compose -f e2e/docker-compose.yml down --remove-orphans`).
- ONE commit `feat(workspace): rotate active group layout (⌃B r)`. Do not push.

## Reviewer live verification (not the implementer)

Dev hub + built app, Playwright: group with two stacked panes → ⌃B r → panes side-by-side (bounding boxes) → ⌃B r again → stacked; palette row + context menu entry work; layout persists across reload.

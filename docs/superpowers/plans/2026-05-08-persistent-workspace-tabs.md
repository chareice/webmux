# Persistent Workspace Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add long-lived zellij-like workspace tabs that group panes by user choice, while keeping workpaths as launch-directory shortcuts only.

**Architecture:** Persist tab metadata in the hub database, carry tab ids on terminal sessions, expose workspace groups in browser state, and make the expanded workspace layout prefer persisted tab ids over cwd fallback groups.

**Tech Stack:** Rust hub with rusqlite and axum, shared TypeScript contracts, React/Expo web UI, Vitest and Cargo tests.

---

### Task 1: Pin Workspace Layout Semantics

**Files:**
- Modify: `packages/app/lib/terminalWorkspaceLayout.test.ts`
- Modify: `packages/app/lib/terminalWorkspaceLayout.ts`

- [ ] Write a failing Vitest test showing two terminals with different `cwd` values stay in one persisted tab when both have the same `workspace_group_id`.
- [ ] Run `pnpm test packages/app/lib/terminalWorkspaceLayout.test.ts` and confirm the new test fails because grouping still uses `cwd`.
- [ ] Add workspace group metadata input to `createTerminalWorkspace` and `reconcileTerminalWorkspace`.
- [ ] Group terminals by `workspace_group_id` when the group exists, otherwise by `cwd`.
- [ ] Preserve empty persisted tabs during reconcile and close operations.
- [ ] Run `pnpm test packages/app/lib/terminalWorkspaceLayout.test.ts` and confirm all tests pass.

### Task 2: Persist Tabs In Browser State

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/app/lib/bootstrapState.test.ts`
- Modify: `packages/app/lib/bootstrapState.ts`

- [ ] Write failing tests for `workspace_groups` from bootstrap snapshots and `workspace_group_created` / `terminal_updated` events.
- [ ] Run `pnpm test packages/app/lib/bootstrapState.test.ts` and confirm the tests fail.
- [ ] Add shared `WorkspaceGroupInfo` contract.
- [ ] Add workspace group state and event handling.
- [ ] Run `pnpm test packages/app/lib/bootstrapState.test.ts` and confirm all tests pass.

### Task 3: Persist Tabs In The Hub

**Files:**
- Create: `crates/hub/src/db/workspace_groups.rs`
- Modify: `crates/hub/src/db/mod.rs`
- Modify: `crates/hub/src/db/types.rs`
- Modify: `crates/hub/src/db/terminal_sessions.rs`
- Modify: `crates/protocol/src/lib.rs`
- Modify: `crates/hub/src/machine_manager.rs`
- Modify: `crates/hub/src/routes/terminals.rs`
- Modify: `crates/hub/src/routes/mod.rs`

- [ ] Add a failing Rust test for terminal session tab assignment persistence.
- [ ] Run `cargo test -p tc-hub terminal_workspace_group` and confirm it fails.
- [ ] Add `workspace_groups` table and `terminal_sessions.workspace_group_id` migration.
- [ ] Add CRUD helpers for listing and creating workspace groups.
- [ ] Add terminal assignment helper and include `workspace_group_id` in terminal rows.
- [ ] Add protocol fields and browser events.
- [ ] Add routes for tab creation, tab listing, and active terminal assignment.
- [ ] Run `cargo test -p tc-hub terminal_workspace_group` and confirm it passes.

### Task 4: Wire The UI

**Files:**
- Modify: `packages/app/lib/api.ts`
- Modify: `packages/app/components/TerminalCanvas.web.tsx`
- Modify: `packages/app/components/TerminalWorkspace.web.tsx`

- [ ] Pass `workspace_group_id` when creating a new pane inside a persisted tab.
- [ ] Pass workspace groups into the expanded workspace.
- [ ] Stop treating selected workpath as workspace membership. Use workpath only as the default launch `cwd` for new terminals.
- [ ] Add a new-tab action that prompts for a tab name, creates the persisted tab, and moves the active pane into it.
- [ ] Add a compact move-to-tab control for the active pane.
- [ ] Run the focused Vitest tests again.

### Task 5: Final Verification

**Files:**
- All modified files

- [ ] Run `pnpm test packages/app/lib/terminalWorkspaceLayout.test.ts packages/app/lib/bootstrapState.test.ts`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `cargo test -p tc-hub`.
- [ ] If container services are available, run `pnpm e2e:test`; otherwise report why it could not run.

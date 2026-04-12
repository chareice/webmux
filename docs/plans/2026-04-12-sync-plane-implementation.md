# Sync Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser state initialization and reconnect deterministic by replacing ad-hoc REST bootstrapping with an authoritative snapshot plus ordered browser event stream.

**Architecture:** The Hub will expose a single bootstrap snapshot with a sequence watermark and will emit browser events inside ordered envelopes. The browser will initialize from the snapshot, then apply only newer envelopes, allowing reconnect without racing parallel REST calls against best-effort live events.

**Tech Stack:** Rust (`axum`, `tokio`, `broadcast`), TypeScript, React.

---

### Task 1: Add failing protocol and manager tests

**Files:**
- Modify: `crates/hub/src/machine_manager.rs`
- Create: `packages/app/lib/bootstrapState.test.mjs`

- [ ] Write failing Rust tests for `snapshot_for_user()` and `subscribe_events_after()`.
- [ ] Run `cargo test -p tc-hub snapshot_for_user subscribe_events_after` and verify compile/test failure.
- [ ] Write failing TypeScript tests for stale envelope rejection and deterministic event application.
- [ ] Run `pnpm --filter @webmux/app exec node --test lib/bootstrapState.test.mjs` and verify failure.

### Task 2: Add snapshot and envelope types

**Files:**
- Modify: `crates/protocol/src/lib.rs`
- Modify: `packages/shared/src/contracts.ts`

- [ ] Add bootstrap snapshot and browser event envelope types.
- [ ] Re-run Rust and TypeScript compilation for the changed protocol surface.

### Task 3: Implement Hub-side sequencing and replay

**Files:**
- Modify: `crates/hub/src/machine_manager.rs`
- Modify: `crates/hub/src/ws.rs`
- Modify: `crates/hub/src/routes/mod.rs`
- Create: `crates/hub/src/routes/bootstrap.rs`

- [ ] Implement monotonic event sequencing and bounded event history.
- [ ] Implement per-user bootstrap snapshot generation.
- [ ] Implement events replay after a given sequence watermark.
- [ ] Expose `/api/bootstrap`.

### Task 4: Implement browser state reducer

**Files:**
- Create: `packages/app/lib/bootstrapState.ts`
- Modify: `packages/app/lib/api.ts`
- Modify: `packages/app/components/TerminalCanvas.web.tsx`
- Modify: `packages/app/components/TerminalCanvas.android.tsx`

- [ ] Implement pure snapshot/envelope application helpers.
- [ ] Initialize browser state from `/api/bootstrap`.
- [ ] Ignore stale or duplicate envelopes.
- [ ] Re-bootstrap on reconnect and reconnect WS with the latest seen sequence.

### Task 5: Verify the phase

**Files:**
- Modify: `docs/plans/2026-04-12-core-architecture-refactor.md`

- [ ] Run `cargo test --workspace`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Update the architecture roadmap with the completed sync-plane slice.

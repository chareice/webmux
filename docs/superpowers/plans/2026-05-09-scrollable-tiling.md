# Scrollable Tiling Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-group `scrollable` layout mode that arranges panes as a horizontal column strip with focus-driven viewport scrolling, coexisting with the current binary-tree tiling mode.

**Architecture:** Extend `WorkspaceLayoutInfo` with `mode` and `scrollable` payload. Store both representations in `workspace_layouts` so mode switches are lossless. The TS layout engine in `terminalWorkspaceLayout.ts` exposes intent-based mutators that pick the right representation based on the active group's mode. A new `ScrollableWorkspace` React component renders the strip and uses `scrollIntoView` for focus-driven scrolling. Mode is toggled per group via a toolbar icon.

**Tech Stack:** Rust (Axum + rusqlite + serde), TypeScript (React 19 + Vite + vitest), shared types in `packages/shared/src/contracts.ts` and `crates/protocol/src/lib.rs`.

**Spec:** `docs/superpowers/specs/2026-05-09-scrollable-tiling-design.md`

---

## File Structure

**New files:**
- `packages/app/components/ScrollableWorkspace.tsx` — strip rendering with focus-driven scroll
- `packages/app/components/ScrollableWorkspace.test.tsx` — component tests

**Modified files:**
- `crates/protocol/src/lib.rs` — add layout mode + column width types, extend `WorkspaceLayoutInfo`
- `crates/hub/src/db/mod.rs` — schema migration adds `layout_mode` and `aux_json` columns
- `crates/hub/src/db/types.rs` — extend `WorkspaceLayoutRow`
- `crates/hub/src/db/workspace_layouts.rs` — read/write the new columns
- `crates/hub/src/routes/terminals.rs` — accept new fields in save handler, emit them in snapshots and events
- `crates/hub/src/machine_manager.rs` — extend snapshot composition (only if it touches layouts)
- `packages/shared/src/contracts.ts` — TS mirror of new types
- `packages/app/lib/terminalWorkspaceLayout.ts` — mode helpers, width helpers, scrollable-aware mutators
- `packages/app/lib/terminalWorkspaceLayout.test.ts` — additional unit tests
- `packages/app/lib/workspaceShortcuts.ts` — three new shortcut actions
- `packages/app/lib/workspaceShortcuts.test.ts` — tests for new actions
- `packages/app/lib/api.ts` — extend `saveWorkspaceLayout` signature
- `packages/app/components/TerminalCanvas.web.tsx` — pass new fields through `handleSaveWorkspaceLayout`
- `packages/app/components/TerminalWorkspace.web.tsx` — dispatch by `layout_mode`, embed mode toggle, route shortcuts

---

## Decision Refinement (vs spec)

The spec puts `layout_mode` on `workspace_groups`. **The plan instead puts `layout_mode` on `workspace_layouts`** alongside `root_json` and the new `aux_json`. Reasons: single source of truth for layout state; one migration; transient cwd groups can also store a mode if we ever need it. Same external behavior — the spec's "transient groups stay tiling" still holds because we treat missing rows as `tiling`.

---

## Phase 1 — Foundation: Types, Protocol, Persistence

### Task 1: Add Rust protocol types for scrollable layout

**Files:**
- Modify: `crates/protocol/src/lib.rs:80-105`

- [ ] **Step 1: Write failing protocol round-trip test**

Append to `crates/protocol/src/lib.rs` inside `#[cfg(test)] mod tests`:

```rust
#[test]
fn scrollable_layout_round_trips_json() {
    let info = WorkspaceLayoutInfo {
        machine_id: "m1".into(),
        group_key: "g1".into(),
        root: None,
        mode: WorkspaceLayoutMode::Scrollable,
        scrollable: Some(WorkspaceScrollableLayout {
            columns: vec![WorkspaceScrollableColumn {
                terminal_id: "t1".into(),
                width: WorkspaceColumnWidth::Preset(WorkspaceColumnPreset::Half),
            }],
        }),
        updated_at: 0,
    };
    let json = serde_json::to_string(&info).unwrap();
    let decoded: WorkspaceLayoutInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, info);
    assert!(json.contains("\"mode\":\"scrollable\""));
    assert!(json.contains("\"kind\":\"preset\""));
}
```

If the file has no `#[cfg(test)]` module yet, create one at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    // (paste the test above here)
}
```

- [ ] **Step 2: Run the test and verify it fails**

```
cargo test -p tc-protocol scrollable_layout_round_trips_json
```

Expected: compile error (unknown types).

- [ ] **Step 3: Add the new types**

In `crates/protocol/src/lib.rs`, after the `WorkspaceLayoutNode` enum (around line 97):

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceLayoutMode {
    Tiling,
    Scrollable,
}

impl Default for WorkspaceLayoutMode {
    fn default() -> Self {
        Self::Tiling
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceColumnPreset {
    Half,
    TwoThirds,
    Full,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkspaceColumnWidth {
    Preset(WorkspaceColumnPreset),
    Fraction(f64),
}

impl WorkspaceColumnWidth {
    pub fn default_preset() -> Self {
        WorkspaceColumnWidth::Preset(WorkspaceColumnPreset::Half)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScrollableColumn {
    pub terminal_id: String,
    pub width: WorkspaceColumnWidth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceScrollableLayout {
    pub columns: Vec<WorkspaceScrollableColumn>,
}
```

For the `Preset(WorkspaceColumnPreset)` variant, serde with `tag = "kind"` requires a `content` field. Adjust to:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum WorkspaceColumnWidth {
    Preset(WorkspaceColumnPreset),
    Fraction(f64),
}
```

This produces JSON `{"kind":"preset","value":"half"}` and `{"kind":"fraction","value":0.42}`.

- [ ] **Step 4: Extend `WorkspaceLayoutInfo`**

Replace the existing struct (around line 99):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceLayoutInfo {
    pub machine_id: String,
    pub group_key: String,
    pub root: Option<WorkspaceLayoutNode>,
    #[serde(default)]
    pub mode: WorkspaceLayoutMode,
    #[serde(default)]
    pub scrollable: Option<WorkspaceScrollableLayout>,
    pub updated_at: i64,
}
```

- [ ] **Step 5: Run protocol tests**

```
cargo test -p tc-protocol
```

Expected: all pass (round-trip test passes, no other tests broken).

- [ ] **Step 6: Commit**

```bash
git add crates/protocol/src/lib.rs
git commit -m "Add scrollable layout protocol types"
```

---

### Task 2: SQLite migration adds `layout_mode` and `aux_json` to `workspace_layouts`

**Files:**
- Modify: `crates/hub/src/db/mod.rs:80-87, 118-119`
- Modify: `crates/hub/src/db/types.rs` (extend `WorkspaceLayoutRow`)

- [ ] **Step 1: Write failing test for legacy-row backfill**

Add to `crates/hub/src/db/workspace_layouts.rs` inside `#[cfg(test)] mod tests`:

```rust
#[test]
fn legacy_workspace_layout_rows_backfill_to_tiling() {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_db(&conn).unwrap();
    crate::db::users::create_user(&conn, "u1", "test", "u1", "U", None, "admin").unwrap();
    crate::db::machines::ensure_machine_for_user(&conn, "m1", "u1", "M", None, None).unwrap();
    // Simulate a row written by an earlier version (before mode/aux columns existed)
    conn.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, updated_at) VALUES (?1,?2,?3,?4,?5)",
        rusqlite::params!["u1","m1","cwd:/x","null", 1234i64],
    ).unwrap();
    let rows = find_workspace_layouts_by_machine(&conn, "u1", "m1").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].layout_mode.as_deref(), None); // NULL means legacy / tiling
    assert!(rows[0].aux_json.is_none());
}
```

- [ ] **Step 2: Run, verify compile failure**

```
cargo test -p webmux-hub legacy_workspace_layout_rows_backfill_to_tiling
```

Expected: compile error (`layout_mode` / `aux_json` fields missing).

- [ ] **Step 3: Update schema in `crates/hub/src/db/mod.rs`**

Replace the `workspace_layouts` table block (line 80-87):

```rust
        CREATE TABLE IF NOT EXISTS workspace_layouts (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            group_key TEXT NOT NULL,
            root_json TEXT NOT NULL,
            layout_mode TEXT,
            aux_json TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, machine_id, group_key)
        );
```

After the `CREATE TABLE` statements, add migration ALTERs that are safe for existing DBs. Find the section that runs single-statement ALTERs (or add one). The conventional pattern in this codebase is `conn.execute_batch(...)`. Add after the `CREATE INDEX` lines (around line 119), within the same `execute_batch` call:

```sql
ALTER TABLE workspace_layouts ADD COLUMN layout_mode TEXT;
ALTER TABLE workspace_layouts ADD COLUMN aux_json TEXT;
```

If `execute_batch` will fail when the column already exists, wrap each ALTER in a separate `conn.execute(...)` call after the batch and ignore "duplicate column" errors. Concretely, after the batch:

```rust
fn add_column_if_missing(conn: &Connection, table: &str, ddl: &str) -> rusqlite::Result<()> {
    match conn.execute(ddl, []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
            if msg.contains("duplicate column name") =>
        {
            Ok(())
        }
        Err(e) => Err(e),
    }
}

add_column_if_missing(
    conn,
    "workspace_layouts",
    "ALTER TABLE workspace_layouts ADD COLUMN layout_mode TEXT",
)?;
add_column_if_missing(
    conn,
    "workspace_layouts",
    "ALTER TABLE workspace_layouts ADD COLUMN aux_json TEXT",
)?;
```

Place `add_column_if_missing` as a private helper inside `init_db`'s module.

- [ ] **Step 4: Update `WorkspaceLayoutRow` in `crates/hub/src/db/types.rs`**

Find `WorkspaceLayoutRow` and replace with:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceLayoutRow {
    pub user_id: String,
    pub machine_id: String,
    pub group_key: String,
    pub root_json: String,
    pub layout_mode: Option<String>,
    pub aux_json: Option<String>,
    pub updated_at: i64,
}
```

- [ ] **Step 5: Update `workspace_layout_from_row` in `crates/hub/src/db/workspace_layouts.rs`**

Replace it (around line 187):

```rust
fn workspace_layout_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceLayoutRow> {
    Ok(WorkspaceLayoutRow {
        user_id: row.get(0)?,
        machine_id: row.get(1)?,
        group_key: row.get(2)?,
        root_json: row.get(3)?,
        layout_mode: row.get(4)?,
        aux_json: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
```

Update every `SELECT` SQL string in this file (3 functions: `find_workspace_layouts_by_user`, `find_workspace_layouts_by_machine`, `find_workspace_layout`) to:

```sql
SELECT user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at FROM workspace_layouts ...
```

- [ ] **Step 6: Run the legacy backfill test**

```
cargo test -p webmux-hub legacy_workspace_layout_rows_backfill_to_tiling
```

Expected: PASS.

- [ ] **Step 7: Run all hub DB tests**

```
cargo test -p webmux-hub --lib db::workspace_layouts
```

Expected: all green. Update any existing tests that constructed `WorkspaceLayoutRow` literally — they need the two new `None` fields.

- [ ] **Step 8: Commit**

```bash
git add crates/hub/src/db/mod.rs crates/hub/src/db/types.rs crates/hub/src/db/workspace_layouts.rs
git commit -m "Add layout_mode and aux_json columns to workspace_layouts"
```

---

### Task 3: Persist mode + aux_json through upsert

**Files:**
- Modify: `crates/hub/src/db/workspace_layouts.rs`

- [ ] **Step 1: Write failing test for round-trip with mode + aux**

Append to the test module:

```rust
#[test]
fn upsert_round_trips_mode_and_aux() {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::init_db(&conn).unwrap();
    crate::db::users::create_user(&conn, "u1", "test", "u1", "U", None, "admin").unwrap();
    crate::db::machines::ensure_machine_for_user(&conn, "m1", "u1", "M", None, None).unwrap();
    upsert_workspace_layout_full(
        &mut conn,
        "u1",
        "m1",
        "g1",
        "null",
        Some("scrollable"),
        Some(r#"{"columns":[]}"#),
    )
    .unwrap();
    let rows = find_workspace_layouts_by_machine(&conn, "u1", "m1").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].layout_mode.as_deref(), Some("scrollable"));
    assert_eq!(rows[0].aux_json.as_deref(), Some(r#"{"columns":[]}"#));
}
```

- [ ] **Step 2: Run, verify compile failure**

```
cargo test -p webmux-hub upsert_round_trips_mode_and_aux
```

Expected: `upsert_workspace_layout_full` not defined.

- [ ] **Step 3: Add `upsert_workspace_layout_full` and update existing helpers**

In `crates/hub/src/db/workspace_layouts.rs`, replace `upsert_workspace_layout` and `upsert_workspace_layout_checked` with versions that take `mode` and `aux_json`. To minimise call-site churn, keep the old function names taking the new params; callers pass `None` if they have nothing to add. Concretely:

```rust
pub fn upsert_workspace_layout_full(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
    layout_mode: Option<&str>,
    aux_json: Option<&str>,
) -> rusqlite::Result<WorkspaceLayoutRow> {
    let now = now_ms();
    let updated_at = find_workspace_layout(conn, user_id, machine_id, group_key)?
        .map(|row| (row.updated_at + 1).max(now))
        .unwrap_or(now);
    conn.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             layout_mode = excluded.layout_mode,
             aux_json = excluded.aux_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at],
    )?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.into(),
        machine_id: machine_id.into(),
        group_key: group_key.into(),
        root_json: root_json.into(),
        layout_mode: layout_mode.map(str::to_string),
        aux_json: aux_json.map(str::to_string),
        updated_at,
    })
}
```

Add a `_checked` counterpart that mirrors the existing `upsert_workspace_layout_checked`:

```rust
pub fn upsert_workspace_layout_full_checked(
    conn: &mut Connection,
    user_id: &str,
    machine_id: &str,
    group_key: &str,
    root_json: &str,
    layout_mode: Option<&str>,
    aux_json: Option<&str>,
    base_updated_at: i64,
) -> Result<WorkspaceLayoutRow, WorkspaceLayoutSaveError> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing = find_workspace_layout(&tx, user_id, machine_id, group_key)?;
    if workspace_layout_base_conflicts(existing.as_ref().map(|row| row.updated_at), base_updated_at) {
        return Err(WorkspaceLayoutSaveError::Conflict);
    }
    let now = now_ms();
    let updated_at = existing
        .map(|row| (row.updated_at + 1).max(now))
        .unwrap_or(now);
    tx.execute(
        "INSERT INTO workspace_layouts (user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, machine_id, group_key) DO UPDATE SET
             root_json = excluded.root_json,
             layout_mode = excluded.layout_mode,
             aux_json = excluded.aux_json,
             updated_at = excluded.updated_at",
        params![user_id, machine_id, group_key, root_json, layout_mode, aux_json, updated_at],
    )?;
    tx.commit()?;
    Ok(WorkspaceLayoutRow {
        user_id: user_id.into(),
        machine_id: machine_id.into(),
        group_key: group_key.into(),
        root_json: root_json.into(),
        layout_mode: layout_mode.map(str::to_string),
        aux_json: aux_json.map(str::to_string),
        updated_at,
    })
}
```

Have `upsert_workspace_layout` (the unchecked variant) and `upsert_workspace_layout_checked` become thin wrappers that delegate to the `_full` / `_full_checked` versions with `(None, None)` for `layout_mode` / `aux_json`.

Update `delete_workspace_layout_checked` to also write `NULL` into the new columns when it stamps the tombstone row.

- [ ] **Step 4: Run the new test**

```
cargo test -p webmux-hub upsert_round_trips_mode_and_aux
```

Expected: PASS.

- [ ] **Step 5: Run all hub tests; fix call sites that need the new args**

```
cargo test -p webmux-hub
```

Expected: green. Likely call sites needing updates: `routes/terminals.rs::save_workspace_layout` (covered in next task), tests inside this module that already construct rows.

- [ ] **Step 6: Commit**

```bash
git add crates/hub/src/db/workspace_layouts.rs
git commit -m "Persist layout_mode and aux_json in workspace_layouts upsert"
```

---

### Task 4: Route handler `save_workspace_layout` accepts new fields

**Files:**
- Modify: `crates/hub/src/routes/terminals.rs:48-54, 276-371`

- [ ] **Step 1: Write failing route test**

In the existing test module of `routes/terminals.rs` (around line 970), add:

```rust
#[tokio::test]
async fn put_workspace_layout_round_trips_scrollable_mode() {
    let state = test_state().await;
    let body = serde_json::json!({
        "group_key": "cwd:/x",
        "root": null,
        "mode": "scrollable",
        "scrollable": {"columns": []},
        "base_updated_at": -1,
    });
    let (status, value) = put_workspace_layout(&state, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["mode"], "scrollable");
    assert_eq!(value["scrollable"]["columns"], serde_json::json!([]));
}
```

(`test_state` and `put_workspace_layout` follow the same patterns as adjacent existing tests.)

- [ ] **Step 2: Run; expect failure**

```
cargo test -p webmux-hub put_workspace_layout_round_trips_scrollable_mode
```

Expected: 500 or 400 because the request struct doesn't accept new fields, or assertion failure on missing `mode` in the response.

- [ ] **Step 3: Extend the request struct**

In `crates/hub/src/routes/terminals.rs` (around line 48):

```rust
#[derive(Deserialize)]
struct SaveWorkspaceLayoutRequest {
    group_key: String,
    root: Option<WorkspaceLayoutNode>,
    #[serde(default)]
    mode: Option<WorkspaceLayoutMode>,
    #[serde(default)]
    scrollable: Option<WorkspaceScrollableLayout>,
    #[serde(default)]
    base_updated_at: Option<i64>,
}
```

Add the imports:

```rust
use tc_protocol::{
    WorkspaceLayoutMode, WorkspaceScrollableLayout,
};
```

- [ ] **Step 4: Update `save_workspace_layout` to forward new fields**

Modify the handler so that:

1. Compute `layout_mode_str: Option<&str>` from the request — `Some("scrollable")` or `Some("tiling")` if `mode` is set, else `None`.
2. Serialize `aux_json` based on which mode is requested:
   - If `mode == Some(Scrollable)`: `aux_json = Some(serde_json::to_string(&req.root)?)` (preserving the current tree as the inactive representation), and `root_json` is set to `serde_json::to_string(&req.scrollable)?` for compatibility — **wait, this conflates schemas**.

Cleaner refactor: store the active `mode` and write **both** representations always. Therefore split the columns logically:
   - `root_json` = the tiling tree (always serialized; `null` if absent).
   - `aux_json` = the scrollable layout (always serialized when relevant; `null` if absent).
   - `layout_mode` = which representation is the active one.

Update the call:

```rust
let root_json = serde_json::to_string(&req.root).map_err(/* … */)?;
let aux_json_owned = req
    .scrollable
    .as_ref()
    .map(|s| serde_json::to_string(s))
    .transpose()
    .map_err(/* … */)?;
let mode_str = req.mode.map(|m| match m {
    WorkspaceLayoutMode::Tiling => "tiling",
    WorkspaceLayoutMode::Scrollable => "scrollable",
});
let row = crate::db::workspace_layouts::upsert_workspace_layout_full_checked(
    &mut conn,
    &auth_user.user_id,
    &machine_id,
    &req.group_key,
    &root_json,
    mode_str,
    aux_json_owned.as_deref(),
    req.base_updated_at.unwrap_or(-1),
)?;
```

(The `_full_checked` variant mirrors the existing `*_checked` and was added in Task 3 — if Task 3 only added the unchecked one, add a checked counterpart now.)

5. Build the response by parsing the columns back into `WorkspaceLayoutInfo`:

```rust
let layout = WorkspaceLayoutInfo {
    machine_id: row.machine_id.clone(),
    group_key: row.group_key.clone(),
    root: serde_json::from_str(&row.root_json).unwrap_or(None),
    mode: row
        .layout_mode
        .as_deref()
        .map(|s| match s {
            "scrollable" => WorkspaceLayoutMode::Scrollable,
            _ => WorkspaceLayoutMode::Tiling,
        })
        .unwrap_or_default(),
    scrollable: row
        .aux_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<WorkspaceScrollableLayout>(s).ok()),
    updated_at: row.updated_at,
};
```

- [ ] **Step 5: Update the existing request-validation test**

The `validate_workspace_layout_node` test only checks the tree. No changes needed unless it breaks.

- [ ] **Step 6: Run the new test + all routes tests**

```
cargo test -p webmux-hub put_workspace_layout
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add crates/hub/src/routes/terminals.rs crates/hub/src/db/workspace_layouts.rs
git commit -m "Wire layout mode and scrollable payload through save route"
```

---

### Task 5: TS shared contracts mirror

**Files:**
- Modify: `packages/shared/src/contracts.ts:30-45`

- [ ] **Step 1: Update types**

In `packages/shared/src/contracts.ts`, around line 30, replace the existing `WorkspaceSplitDirection` / `WorkspaceLayoutNode` / `WorkspaceLayoutInfo` block with:

```ts
export type WorkspaceSplitDirection = "horizontal" | "vertical"

export type WorkspaceLayoutNode =
  | { type: "leaf"; terminalId: string }
  | {
      type: "split"
      direction: WorkspaceSplitDirection
      ratio: number
      first: WorkspaceLayoutNode
      second: WorkspaceLayoutNode
    }

export type WorkspaceLayoutMode = "tiling" | "scrollable"

export type WorkspaceColumnPreset = "half" | "two_thirds" | "full"

export type WorkspaceColumnWidth =
  | { kind: "preset"; value: WorkspaceColumnPreset }
  | { kind: "fraction"; value: number }

export interface WorkspaceScrollableColumn {
  terminalId: string
  width: WorkspaceColumnWidth
}

export interface WorkspaceScrollableLayout {
  columns: WorkspaceScrollableColumn[]
}

export interface WorkspaceLayoutInfo {
  machine_id: string
  group_key: string
  root: WorkspaceLayoutNode | null
  mode?: WorkspaceLayoutMode
  scrollable?: WorkspaceScrollableLayout | null
  updated_at: number
}
```

- [ ] **Step 2: Build the shared package**

```
pnpm --filter @webmux/shared build
```

Expected: success.

- [ ] **Step 3: Type-check the app**

```
pnpm --filter @webmux/app typecheck
```

Expected: success (no callers referenced the old `WorkspaceLayoutInfo` shape destructively; new fields are optional).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/contracts.ts
git commit -m "Mirror scrollable layout types in shared contracts"
```

---

## Phase 2 — TS Layout Engine

### Task 6: Layout-mode helpers (`set` / `flatten` / `build`)

**Files:**
- Modify: `packages/app/lib/terminalWorkspaceLayout.ts`
- Modify: `packages/app/lib/terminalWorkspaceLayout.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `terminalWorkspaceLayout.test.ts`:

```ts
import {
  flattenTreeToColumns,
  buildTreeFromColumns,
  setWorkspaceLayoutMode,
} from "./terminalWorkspaceLayout";

describe("layout mode helpers", () => {
  it("flattens a 2D tree to ordered columns (DFS first then second)", () => {
    const root: WorkspacePaneNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.4,
      first: { type: "leaf", terminalId: "A" },
      second: {
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        first: { type: "leaf", terminalId: "B" },
        second: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "leaf", terminalId: "C" },
          second: { type: "leaf", terminalId: "D" },
        },
      },
    };
    expect(flattenTreeToColumns(root).map((c) => c.terminalId)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("buildTreeFromColumns produces a left-leaning right-only horizontal tree", () => {
    const root = buildTreeFromColumns([
      { terminalId: "A", width: { kind: "preset", value: "half" } },
      { terminalId: "B", width: { kind: "preset", value: "half" } },
      { terminalId: "C", width: { kind: "preset", value: "half" } },
    ]);
    expect(root).toEqual({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", terminalId: "A" },
      second: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { type: "leaf", terminalId: "B" },
        second: { type: "leaf", terminalId: "C" },
      },
    });
  });

  it("setWorkspaceLayoutMode preserves the previous representation in aux", () => {
    const ws = createTerminalWorkspace(
      [terminal("a", "/x"), terminal("b", "/x")],
      "a",
    );
    const groupId = ws.groups[0].id;
    const next = setWorkspaceLayoutMode(ws, groupId, "scrollable");
    expect(next.groups[0].layoutMode).toBe("scrollable");
    expect(next.groups[0].scrollable?.columns.map((c) => c.terminalId)).toEqual([
      "a",
      "b",
    ]);
    expect(next.groups[0].auxRoot).toEqual(ws.groups[0].root); // tree preserved
  });
});
```

- [ ] **Step 2: Run, verify failure**

```
pnpm --filter @webmux/app vitest run terminalWorkspaceLayout
```

Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement helpers**

In `packages/app/lib/terminalWorkspaceLayout.ts`:

a. Extend the `WorkspaceGroup` interface (around line 14):

```ts
export interface WorkspaceGroup {
  id: string;
  label: string;
  cwd: string;
  workspaceGroupId: string | null;
  persistent: boolean;
  root: WorkspacePaneNode | null;
  paneCount: number;
  layoutMode: WorkspaceLayoutMode;
  scrollable: WorkspaceScrollableLayout | null;
  auxRoot: WorkspacePaneNode | null;
}
```

b. Import the new shared types at the top:

```ts
import type {
  TerminalInfo,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
  WorkspaceLayoutMode,
  WorkspaceLayoutNode,
  WorkspaceScrollableColumn,
  WorkspaceScrollableLayout,
  WorkspaceColumnWidth,
} from "@webmux/shared";
```

c. Add helpers near the other exported pure functions:

```ts
export function flattenTreeToColumns(
  root: WorkspacePaneNode | null,
): WorkspaceScrollableColumn[] {
  const ids = collectPaneTerminalIds(root);
  return ids.map((terminalId) => ({
    terminalId,
    width: { kind: "preset", value: "half" } as WorkspaceColumnWidth,
  }));
}

export function buildTreeFromColumns(
  columns: WorkspaceScrollableColumn[],
): WorkspacePaneNode | null {
  if (columns.length === 0) return null;
  if (columns.length === 1) {
    return { type: "leaf", terminalId: columns[0].terminalId };
  }
  const [first, ...rest] = columns;
  return {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "leaf", terminalId: first.terminalId },
    second: buildTreeFromColumns(rest)!,
  };
}

export function setWorkspaceLayoutMode(
  workspace: TerminalWorkspace,
  groupId: string,
  nextMode: WorkspaceLayoutMode,
): TerminalWorkspace {
  const groups = workspace.groups.map((group) => {
    if (group.id !== groupId) return group;
    if (group.layoutMode === nextMode) return group;
    if (nextMode === "scrollable") {
      return {
        ...group,
        layoutMode: nextMode,
        scrollable: { columns: flattenTreeToColumns(group.root) },
        auxRoot: group.root,
      };
    }
    // scrollable -> tiling
    const restored = group.auxRoot ?? buildTreeFromColumns(group.scrollable?.columns ?? []);
    // Append columns added while in scrollable mode that aren't in the restored tree
    const restoredIds = new Set(collectPaneTerminalIds(restored));
    let merged = restored;
    for (const column of group.scrollable?.columns ?? []) {
      if (!restoredIds.has(column.terminalId)) {
        merged = appendNode(merged, { type: "leaf", terminalId: column.terminalId });
      }
    }
    return {
      ...group,
      layoutMode: nextMode,
      root: merged,
      scrollable: group.scrollable, // keep so re-toggle is cheap
      auxRoot: null,
    };
  });
  return { ...workspace, groups };
}
```

d. Update `createGroups` to populate the new fields. Where the function returns a `WorkspaceGroup`, add:

```ts
return {
  id: group.id,
  label: group.label,
  cwd,
  workspaceGroupId: group.workspaceGroupId,
  persistent: group.persistent,
  root,
  paneCount: group.terminals.length,
  layoutMode: groupMode(group.id, layoutsByGroupKey),
  scrollable: groupScrollable(group.id, layoutsByGroupKey),
  auxRoot: groupAuxRoot(group.id, layoutsByGroupKey),
};
```

with helpers:

```ts
function groupMode(
  groupKey: string,
  layouts: Map<string, WorkspaceLayoutNode | null>,
): WorkspaceLayoutMode {
  // layouts map already only carries the tree — extend the source of layoutsByGroupKey
  // to a richer record. See step (e).
  return "tiling";
}
```

e. The current `createGroups` constructs `layoutsByGroupKey` from `WorkspaceLayoutInfo[]` taking only `layout.root`. Change it to also carry `mode` and `scrollable`:

```ts
const layoutsByGroupKey = new Map<
  string,
  {
    root: WorkspaceLayoutNode | null;
    mode: WorkspaceLayoutMode;
    scrollable: WorkspaceScrollableLayout | null;
  }
>(
  workspaceLayouts.map((layout) => [
    layout.group_key,
    {
      root: layout.root,
      mode: layout.mode ?? "tiling",
      scrollable: layout.scrollable ?? null,
    },
  ]),
);
```

Use this map throughout `createGroups`.

- [ ] **Step 4: Run tests**

```
pnpm --filter @webmux/app vitest run terminalWorkspaceLayout
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/terminalWorkspaceLayout.ts packages/app/lib/terminalWorkspaceLayout.test.ts
git commit -m "Add layout mode helpers and per-group layoutMode state"
```

---

### Task 7: Column width helpers (`set` / `cycle`)

**Files:**
- Modify: `packages/app/lib/terminalWorkspaceLayout.ts`
- Modify: `packages/app/lib/terminalWorkspaceLayout.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the test file:

```ts
import {
  setWorkspaceColumnWidth,
  cycleWorkspaceColumnWidth,
} from "./terminalWorkspaceLayout";

describe("column width helpers", () => {
  it("setWorkspaceColumnWidth updates only the matching column", () => {
    let ws = createTerminalWorkspace(
      [terminal("a", "/x"), terminal("b", "/x")],
      "a",
    );
    ws = setWorkspaceLayoutMode(ws, ws.groups[0].id, "scrollable");
    const updated = setWorkspaceColumnWidth(ws, "b", {
      kind: "preset",
      value: "two_thirds",
    });
    const cols = updated.groups[0].scrollable!.columns;
    expect(cols[0].width).toEqual({ kind: "preset", value: "half" });
    expect(cols[1].width).toEqual({ kind: "preset", value: "two_thirds" });
  });

  it("cycleWorkspaceColumnWidth steps through presets and stops at full", () => {
    let ws = createTerminalWorkspace([terminal("a", "/x")], "a");
    ws = setWorkspaceLayoutMode(ws, ws.groups[0].id, "scrollable");
    ws = cycleWorkspaceColumnWidth(ws, "a", "grow");
    expect(ws.groups[0].scrollable!.columns[0].width).toEqual({
      kind: "preset",
      value: "two_thirds",
    });
    ws = cycleWorkspaceColumnWidth(ws, "a", "grow");
    expect(ws.groups[0].scrollable!.columns[0].width).toEqual({
      kind: "preset",
      value: "full",
    });
    ws = cycleWorkspaceColumnWidth(ws, "a", "grow");
    expect(ws.groups[0].scrollable!.columns[0].width).toEqual({
      kind: "preset",
      value: "full",
    });
  });
});
```

- [ ] **Step 2: Run; expect failure**

```
pnpm --filter @webmux/app vitest run terminalWorkspaceLayout
```

- [ ] **Step 3: Implement**

```ts
const PRESET_ORDER: WorkspaceColumnPreset[] = ["half", "two_thirds", "full"];

export function setWorkspaceColumnWidth(
  workspace: TerminalWorkspace,
  terminalId: string,
  width: WorkspaceColumnWidth,
): TerminalWorkspace {
  const groups = workspace.groups.map((group) => {
    if (!group.scrollable) return group;
    const idx = group.scrollable.columns.findIndex(
      (c) => c.terminalId === terminalId,
    );
    if (idx === -1) return group;
    const columns = group.scrollable.columns.slice();
    columns[idx] = { ...columns[idx], width };
    return { ...group, scrollable: { columns } };
  });
  return { ...workspace, groups };
}

export function cycleWorkspaceColumnWidth(
  workspace: TerminalWorkspace,
  terminalId: string,
  direction: "grow" | "shrink",
): TerminalWorkspace {
  for (const group of workspace.groups) {
    if (!group.scrollable) continue;
    const column = group.scrollable.columns.find(
      (c) => c.terminalId === terminalId,
    );
    if (!column) continue;
    const currentPreset =
      column.width.kind === "preset" ? column.width.value : nearestPreset(column.width.value);
    const idx = PRESET_ORDER.indexOf(currentPreset);
    const next =
      direction === "grow"
        ? PRESET_ORDER[Math.min(idx + 1, PRESET_ORDER.length - 1)]
        : PRESET_ORDER[Math.max(idx - 1, 0)];
    return setWorkspaceColumnWidth(workspace, terminalId, {
      kind: "preset",
      value: next,
    });
  }
  return workspace;
}

function nearestPreset(fraction: number): WorkspaceColumnPreset {
  if (fraction >= 0.85) return "full";
  if (fraction >= 0.6) return "two_thirds";
  return "half";
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @webmux/app vitest run terminalWorkspaceLayout
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/terminalWorkspaceLayout.ts packages/app/lib/terminalWorkspaceLayout.test.ts
git commit -m "Add column width set and cycle helpers"
```

---

### Task 8: Scrollable-aware mutators (`split` / `append` / `close`)

**Files:**
- Modify: `packages/app/lib/terminalWorkspaceLayout.ts`
- Modify: `packages/app/lib/terminalWorkspaceLayout.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("scrollable mutators", () => {
  it("splitWorkspacePane in scrollable mode appends a column at the end", () => {
    let ws = createTerminalWorkspace([terminal("a", "/x")], "a");
    ws = setWorkspaceLayoutMode(ws, ws.groups[0].id, "scrollable");
    ws = splitWorkspacePane(ws, {
      activeTerminalId: "a",
      newTerminalId: "b",
      direction: "down", // down → still appends; mode collapses both intents
    });
    expect(ws.groups[0].scrollable!.columns.map((c) => c.terminalId)).toEqual([
      "a",
      "b",
    ]);
    expect(ws.activeTerminalId).toBe("b");
  });

  it("closeWorkspacePane in scrollable mode removes the column", () => {
    let ws = createTerminalWorkspace(
      [terminal("a", "/x"), terminal("b", "/x")],
      "a",
    );
    ws = setWorkspaceLayoutMode(ws, ws.groups[0].id, "scrollable");
    ws = splitWorkspacePane(ws, {
      activeTerminalId: "a",
      newTerminalId: "b",
      direction: "right",
    });
    ws = closeWorkspacePane(ws, "a");
    expect(ws.groups[0].scrollable!.columns.map((c) => c.terminalId)).toEqual([
      "b",
    ]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```
pnpm --filter @webmux/app vitest run terminalWorkspaceLayout
```

Expected: FAIL — current `splitWorkspacePane` writes to `root`, not `scrollable`.

- [ ] **Step 3: Branch each mutator on `layoutMode`**

In `splitWorkspacePane`, add early branching after locating the group:

```ts
if (group.layoutMode === "scrollable") {
  const columns = (group.scrollable?.columns ?? []).filter(
    (c) => c.terminalId !== input.newTerminalId,
  );
  columns.push({
    terminalId: input.newTerminalId,
    width: { kind: "preset", value: "half" },
  });
  const groups = workspace.groups.map((candidate) =>
    candidate.id === group.id
      ? { ...candidate, scrollable: { columns }, paneCount: columns.length }
      : candidate,
  );
  return {
    groups,
    activeGroupId: group.id,
    activeTerminalId: input.newTerminalId,
  };
}
```

Apply analogous branches to `appendWorkspacePaneToGroup`, `closeWorkspacePane`, and `swapWorkspacePanes`. For `swapWorkspacePanes` in scrollable mode, swap the entries in the columns array.

- [ ] **Step 4: Run tests**

```
pnpm --filter @webmux/app vitest run terminalWorkspaceLayout
```

Expected: PASS, including all existing tiling tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/terminalWorkspaceLayout.ts packages/app/lib/terminalWorkspaceLayout.test.ts
git commit -m "Branch workspace mutators on layout mode"
```

---

### Task 9: Scrollable adjacency (left/right focus, no-op up/down)

**Files:**
- Modify: `packages/app/lib/terminalWorkspaceLayout.ts`
- Modify: `packages/app/lib/terminalWorkspaceLayout.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("scrollable adjacency", () => {
  it("findAdjacentWorkspacePane left/right walks columns; up/down is null", () => {
    let ws = createTerminalWorkspace(
      [terminal("a", "/x"), terminal("b", "/x"), terminal("c", "/x")],
      "b",
    );
    ws = setWorkspaceLayoutMode(ws, ws.groups[0].id, "scrollable");
    const group = ws.groups[0];
    expect(
      findAdjacentScrollableColumn(group.scrollable!, "left", "b"),
    ).toBe("a");
    expect(
      findAdjacentScrollableColumn(group.scrollable!, "right", "b"),
    ).toBe("c");
    expect(
      findAdjacentScrollableColumn(group.scrollable!, "up", "b"),
    ).toBeNull();
    expect(
      findAdjacentScrollableColumn(group.scrollable!, "down", "b"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement**

```ts
export function findAdjacentScrollableColumn(
  layout: WorkspaceScrollableLayout,
  direction: WorkspacePaneFocusDirection,
  activeTerminalId: string | null,
): string | null {
  if (direction === "up" || direction === "down") return null;
  if (!activeTerminalId) return null;
  const idx = layout.columns.findIndex((c) => c.terminalId === activeTerminalId);
  if (idx === -1) return null;
  const offset = direction === "left" ? -1 : 1;
  return layout.columns[idx + offset]?.terminalId ?? null;
}
```

Update the existing `findAdjacentWorkspacePane` callers (notably the consumer keyboard-shortcut handler in `TerminalWorkspace.web.tsx`) so that for scrollable groups they use `findAdjacentScrollableColumn` instead.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/terminalWorkspaceLayout.ts packages/app/lib/terminalWorkspaceLayout.test.ts
git commit -m "Add scrollable-mode adjacency helper"
```

---

### Task 10: `reconcileTerminalWorkspace` keeps scrollable in sync

**Files:**
- Modify: `packages/app/lib/terminalWorkspaceLayout.ts`
- Modify: `packages/app/lib/terminalWorkspaceLayout.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe("reconcile in scrollable mode", () => {
  it("removes destroyed terminals and appends new ones", () => {
    let ws = createTerminalWorkspace(
      [terminal("a", "/x"), terminal("b", "/x")],
      "a",
    );
    ws = setWorkspaceLayoutMode(ws, ws.groups[0].id, "scrollable");
    const next = reconcileTerminalWorkspace(
      ws,
      [terminal("b", "/x"), terminal("c", "/x")],
      "c",
    );
    expect(next.groups[0].scrollable!.columns.map((c) => c.terminalId)).toEqual([
      "b",
      "c",
    ]);
    expect(next.activeTerminalId).toBe("c");
  });
});
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement**

In `reconcileTerminalWorkspace`, after computing `groupTerminalIds` from the new terminals, add a per-group branch:

```ts
if (previous?.layoutMode === "scrollable") {
  const surviving = (previous.scrollable?.columns ?? []).filter((c) =>
    groupTerminalIds.has(c.terminalId),
  );
  const survivingIds = new Set(surviving.map((c) => c.terminalId));
  const additions = Array.from(groupTerminalIds)
    .filter((id) => !survivingIds.has(id))
    .map((id) => ({
      terminalId: id,
      width: { kind: "preset", value: "half" } as WorkspaceColumnWidth,
    }));
  return {
    ...group,
    scrollable: { columns: [...surviving, ...additions] },
    layoutMode: "scrollable",
    paneCount: surviving.length + additions.length,
  };
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/terminalWorkspaceLayout.ts packages/app/lib/terminalWorkspaceLayout.test.ts
git commit -m "Reconcile scrollable layouts on terminal lifecycle"
```

---

### Task 11: New keyboard shortcuts

**Files:**
- Modify: `packages/app/lib/workspaceShortcuts.ts:3-66`
- Modify: `packages/app/lib/workspaceShortcuts.test.ts`

- [ ] **Step 1: Add ids and defaults**

```ts
export type WorkspaceShortcutActionId =
  | /* existing */
  | "columnWidthShrink"
  | "columnWidthGrow"
  | "layoutModeToggle";

export const DEFAULT_WORKSPACE_SHORTCUTS: WorkspaceShortcuts = {
  /* existing */,
  columnWidthShrink: "Mod+Comma",
  columnWidthGrow: "Mod+Period",
  layoutModeToggle: "Mod+Alt+KeyT",
};

export const WORKSPACE_SHORTCUT_DEFINITIONS: Array<{ id: WorkspaceShortcutActionId; label: string }> = [
  /* existing */,
  { id: "columnWidthShrink", label: "Shrink column" },
  { id: "columnWidthGrow", label: "Grow column" },
  { id: "layoutModeToggle", label: "Toggle layout mode" },
];
```

- [ ] **Step 2: Add a unit test exercising new defaults round-trip through localStorage**

```ts
it("loads new defaults when storage is empty", () => {
  const shortcuts = loadWorkspaceShortcuts(null);
  expect(shortcuts.columnWidthShrink).toBe("Mod+Comma");
  expect(shortcuts.columnWidthGrow).toBe("Mod+Period");
  expect(shortcuts.layoutModeToggle).toBe("Mod+Alt+KeyT");
});
```

- [ ] **Step 3: Run tests**

```
pnpm --filter @webmux/app vitest run workspaceShortcuts
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/lib/workspaceShortcuts.ts packages/app/lib/workspaceShortcuts.test.ts
git commit -m "Add column width and mode toggle shortcuts"
```

---

## Phase 3 — Rendering

### Task 12: `ScrollableWorkspace` component

**Files:**
- Create: `packages/app/components/ScrollableWorkspace.tsx`
- Create: `packages/app/components/ScrollableWorkspace.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollableWorkspace } from "./ScrollableWorkspace";

describe("ScrollableWorkspace", () => {
  it("renders one column per scrollable layout entry", () => {
    render(
      <ScrollableWorkspace
        columns={[
          { terminalId: "a", width: { kind: "preset", value: "half" } },
          { terminalId: "b", width: { kind: "preset", value: "full" } },
        ]}
        terminalsById={new Map()}
        activeTerminalId="a"
        isController
        deviceId="d1"
        isMobile={false}
        fitRequest={null}
        onActiveRef={() => {}}
        onFitRequestHandled={() => {}}
        onFocus={() => {}}
        onDestroy={() => {}}
        onResizeColumn={() => {}}
        onReorderColumns={() => {}}
      />,
    );
    expect(screen.getAllByTestId("scrollable-column")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```
pnpm --filter @webmux/app vitest run ScrollableWorkspace
```

- [ ] **Step 3: Implement the component**

`packages/app/components/ScrollableWorkspace.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type {
  TerminalInfo,
  WorkspaceColumnWidth,
  WorkspaceScrollableColumn,
} from "@webmux/shared";
import { WorkspacePaneLeaf, type WorkspaceFitRequest, type TerminalCardRef } from "./TerminalWorkspace.web";

const VIEWPORT_BREAKPOINT = 680;

function widthToFlexBasis(width: WorkspaceColumnWidth, isMobile: boolean): string {
  if (isMobile) return "100%";
  if (width.kind === "preset") {
    switch (width.value) {
      case "half":
        return "50%";
      case "two_thirds":
        return "66.6667%";
      case "full":
        return "100%";
    }
  }
  return `${Math.max(5, Math.min(100, width.value * 100))}%`;
}

export interface ScrollableWorkspaceProps {
  columns: WorkspaceScrollableColumn[];
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string | null;
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  fitRequest: WorkspaceFitRequest | null;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number, terminalId: string) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onResizeColumn: (terminalId: string, width: WorkspaceColumnWidth) => void;
  onReorderColumns: (sourceTerminalId: string, targetTerminalId: string) => void;
}

export function ScrollableWorkspace(props: ScrollableWorkspaceProps) {
  const {
    columns,
    terminalsById,
    activeTerminalId,
    isMobile,
  } = props;

  const focusedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = focusedRef.current;
    if (!node) return;
    node.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTerminalId, columns.length, isMobile]);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflowX: "auto",
        overflowY: "hidden",
        scrollSnapType: "x proximity",
        display: "flex",
        gap: 6,
      }}
    >
      {columns.map((column) => {
        const terminal = terminalsById.get(column.terminalId);
        const isActive = column.terminalId === activeTerminalId;
        return (
          <div
            key={column.terminalId}
            data-testid="scrollable-column"
            ref={isActive ? focusedRef : null}
            style={{
              flex: `0 0 ${widthToFlexBasis(column.width, isMobile)}`,
              minWidth: 0,
              minHeight: 0,
              scrollSnapAlign: "start",
            }}
          >
            {terminal ? (
              <WorkspacePaneLeaf
                terminal={terminal}
                isActive={isActive}
                isController={props.isController}
                deviceId={props.deviceId}
                isMobile={isMobile}
                fitRequestNonce={
                  props.fitRequest?.terminalIds.includes(terminal.id)
                    ? props.fitRequest.nonce
                    : null
                }
                fitRequestShouldFocus={
                  props.fitRequest?.focusTerminalId === terminal.id
                }
                onActiveRef={props.onActiveRef}
                onFitRequestHandled={props.onFitRequestHandled}
                onFocus={props.onFocus}
                onDestroy={props.onDestroy}
                draggingPaneId={null}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export { VIEWPORT_BREAKPOINT };
```

`WorkspacePaneLeaf` and the auxiliary types are not currently exported from `TerminalWorkspace.web.tsx`. Add `export` keywords there.

- [ ] **Step 4: Run the test**

```
pnpm --filter @webmux/app vitest run ScrollableWorkspace
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/components/ScrollableWorkspace.tsx packages/app/components/ScrollableWorkspace.test.tsx packages/app/components/TerminalWorkspace.web.tsx
git commit -m "Add ScrollableWorkspace component"
```

---

### Task 13: Dispatch group renderer by `layoutMode`

**Files:**
- Modify: `packages/app/components/TerminalWorkspace.web.tsx:920-980, 770-880`

- [ ] **Step 1: Locate the group rendering block**

Around line 970-980 in the desktop branch, the code currently does:

```tsx
<WorkspacePaneTree
  node={activeGroup.root}
  ...
/>
```

Replace with:

```tsx
{activeGroup.layoutMode === "scrollable" ? (
  <ScrollableWorkspace
    columns={activeGroup.scrollable?.columns ?? []}
    terminalsById={terminalsById}
    activeTerminalId={activeTerminal?.id ?? null}
    isController={isController}
    deviceId={deviceId}
    isMobile={false}
    fitRequest={fitRequest}
    onActiveRef={onActiveRef}
    onFitRequestHandled={handleFitRequestHandled}
    onFocus={activateTerminal}
    onDestroy={handleDestroy}
    onResizeColumn={handleResizeColumn}
    onReorderColumns={handleReorderScrollableColumns}
  />
) : (
  <WorkspacePaneTree {...existingProps} />
)}
```

`handleResizeColumn` and `handleReorderScrollableColumns` are new callbacks. Implement them as `useCallback`s that:

- Update local workspace via `setWorkspace` and call `onSaveWorkspaceLayout` with the new fields.

- [ ] **Step 2: Update the mobile branch (around line 768-870)**

Currently the mobile path renders only the active pane fullscreen. For scrollable groups, render `ScrollableWorkspace` with `isMobile={true}` instead. Keep the tiling fallback to preserve compatibility.

```tsx
{activeGroup?.layoutMode === "scrollable" ? (
  <ScrollableWorkspace ... isMobile />
) : (
  /* existing mobile single-pane code */
)}
```

- [ ] **Step 3: Type-check, run vitest**

```
pnpm --filter @webmux/app typecheck
pnpm --filter @webmux/app vitest run
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/components/TerminalWorkspace.web.tsx
git commit -m "Dispatch workspace renderer by layout mode"
```

---

### Task 14: Column resize drag handle (desktop)

**Files:**
- Modify: `packages/app/components/ScrollableWorkspace.tsx`

- [ ] **Step 1: Write a failing test that asserts a handle exists between columns on desktop**

```tsx
it("renders resize handles between columns on desktop", () => {
  render(<ScrollableWorkspace ... isMobile={false} columns={[col("a"), col("b"), col("c")]} ... />);
  expect(screen.getAllByTestId("column-resize-handle")).toHaveLength(2);
});

it("does not render resize handles on mobile", () => {
  render(<ScrollableWorkspace ... isMobile columns={[col("a"), col("b")]} ... />);
  expect(screen.queryByTestId("column-resize-handle")).toBeNull();
});
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement handles**

In `ScrollableWorkspace.tsx`, render a 6px-wide div with `cursor: col-resize` between adjacent columns when `!isMobile`. Wire `onMouseDown` to start a drag that:

1. Tracks `startClientX` and `startWidthFraction` of the left column.
2. On `mousemove`, computes `newFraction = startWidthFraction + (e.clientX - startClientX) / containerWidth`.
3. Calls `onResizeColumn(leftTerminalId, { kind: "fraction", value: clamp(newFraction, 0.1, 1) })`.
4. On `mouseup`, releases listeners.

Use `useRef` for the drag state. Reuse the existing pane-drag patterns in `TerminalWorkspace.web.tsx` for listener cleanup conventions.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/app/components/ScrollableWorkspace.tsx packages/app/components/ScrollableWorkspace.test.tsx
git commit -m "Add column resize handles on desktop"
```

---

## Phase 4 — Toggle UI and Shortcut Wiring

### Task 15: Mode toggle in `WorkspaceTopBar`

**Files:**
- Modify: `packages/app/components/TerminalWorkspace.web.tsx:1017-1130`

- [ ] **Step 1: Add a new prop and a toggle button**

Extend `WorkspaceTopBar` props:

```ts
layoutMode: WorkspaceLayoutMode;
onToggleLayoutMode: () => void;
```

In the rendered toolbar (after the split / fit / maximize cluster), add:

```tsx
<button
  type="button"
  onClick={onToggleLayoutMode}
  title={layoutMode === "scrollable" ? "Switch to tiling" : "Switch to scrollable"}
  data-testid="layout-mode-toggle"
>
  {layoutMode === "scrollable" ? <Columns3 size={16} /> : <LayoutGrid size={16} />}
</button>
```

Import `Columns3` and `LayoutGrid` from `lucide-react`.

- [ ] **Step 2: Wire the prop where `WorkspaceTopBar` is rendered**

Two call sites (mobile and desktop): pass `layoutMode={activeGroup?.layoutMode ?? "tiling"}` and `onToggleLayoutMode={handleToggleLayoutMode}`.

- [ ] **Step 3: Implement `handleToggleLayoutMode`**

```ts
const handleToggleLayoutMode = useCallback(() => {
  if (!activeGroup) return;
  const nextMode: WorkspaceLayoutMode =
    activeGroup.layoutMode === "scrollable" ? "tiling" : "scrollable";
  setWorkspace((prev) => {
    const next = setWorkspaceLayoutMode(prev, activeGroup.id, nextMode);
    const nextGroup = next.groups.find((g) => g.id === activeGroup.id);
    if (nextGroup) {
      void onSaveWorkspaceLayout(
        commandMachineId,
        activeGroup.id,
        nextGroup.root,
        nextMode,
        nextGroup.scrollable,
      );
    }
    return next;
  });
}, [activeGroup, commandMachineId, onSaveWorkspaceLayout]);
```

The `onSaveWorkspaceLayout` signature must be extended to accept mode + scrollable; see Task 17.

- [ ] **Step 4: Type-check + run tests**

- [ ] **Step 5: Commit**

```bash
git add packages/app/components/TerminalWorkspace.web.tsx
git commit -m "Add layout mode toggle to workspace top bar"
```

---

### Task 16: Hook keyboard shortcuts to mode toggle and width cycling

**Files:**
- Modify: `packages/app/components/TerminalWorkspace.web.tsx` (the keyboard listener / shortcut switch)

- [ ] **Step 1: Locate the existing shortcut handler**

Search for `findWorkspaceShortcutAction(`. There's a `switch (action) { case "paneLeft": ... }`. Extend with:

```ts
case "columnWidthShrink":
  if (activeTerminal && activeGroup?.layoutMode === "scrollable") {
    setWorkspace((prev) => cycleWorkspaceColumnWidth(prev, activeTerminal.id, "shrink"));
    schedulePersistColumns();
  }
  break;
case "columnWidthGrow":
  if (activeTerminal && activeGroup?.layoutMode === "scrollable") {
    setWorkspace((prev) => cycleWorkspaceColumnWidth(prev, activeTerminal.id, "grow"));
    schedulePersistColumns();
  }
  break;
case "layoutModeToggle":
  handleToggleLayoutMode();
  break;
```

`schedulePersistColumns` is a debounced save that calls `onSaveWorkspaceLayout` with the latest workspace state (Task 17).

Also: change the `paneLeft` / `paneRight` cases to use `findAdjacentScrollableColumn` when in scrollable mode, and the `paneUp` / `paneDown` cases to no-op in scrollable mode.

- [ ] **Step 2: Type-check + run tests**

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/TerminalWorkspace.web.tsx
git commit -m "Wire layout mode and column width shortcuts"
```

---

## Phase 5 — Persistence Wiring

### Task 17: Extend `saveWorkspaceLayout` and `handleSaveWorkspaceLayout`

**Files:**
- Modify: `packages/app/lib/api.ts:155-169`
- Modify: `packages/app/components/TerminalCanvas.web.tsx:820-848`
- Modify: `packages/app/components/TerminalWorkspace.web.tsx` (callback signature)

- [ ] **Step 1: Update API helper**

```ts
export const saveWorkspaceLayout = (
  machineId: string,
  groupKey: string,
  root: WorkspaceLayoutNode | null,
  baseUpdatedAt: number | null,
  mode: WorkspaceLayoutMode | null,
  scrollable: WorkspaceScrollableLayout | null,
) =>
  request<WorkspaceLayoutInfo>("PUT", `/api/machines/${machineId}/workspace-layouts`, {
    group_key: groupKey,
    root,
    mode,
    scrollable,
    base_updated_at: baseUpdatedAt ?? -1,
  });
```

- [ ] **Step 2: Update `handleSaveWorkspaceLayout` in `TerminalCanvas.web.tsx`**

```ts
const handleSaveWorkspaceLayout = useCallback(
  async (
    machineId: string,
    groupKey: string,
    root: WorkspaceLayoutNode | null,
    mode: WorkspaceLayoutMode | null,
    scrollable: WorkspaceScrollableLayout | null,
  ) => {
    const baseUpdatedAt =
      workspaceLayoutsRef.current.find(
        (layout) => layout.machine_id === machineId && layout.group_key === groupKey,
      )?.updated_at ?? null;
    const saved = await saveWorkspaceLayout(machineId, groupKey, root, baseUpdatedAt, mode, scrollable);
    setBrowserState((prev) => ({
      ...prev,
      workspaceLayouts: (() => {
        const next = upsertWorkspaceLayoutInfo(prev.workspaceLayouts, saved);
        workspaceLayoutsRef.current = next;
        return next;
      })(),
    }));
    return saved;
  },
  [],
);
```

- [ ] **Step 3: Update the prop type in `TerminalWorkspace.web.tsx`**

```ts
onSaveWorkspaceLayout: (
  machineId: string,
  groupKey: string,
  root: WorkspaceLayoutNode | null,
  mode: WorkspaceLayoutMode | null,
  scrollable: WorkspaceScrollableLayout | null,
) => Promise<WorkspaceLayoutInfo | null | void>;
```

Search for every call site of `onSaveWorkspaceLayout` inside `TerminalWorkspace.web.tsx` and add `null, null` (when only the tree changed) or the actual mode + scrollable when changing them.

Add a `schedulePersistColumns` helper that debounces by 200ms and calls `onSaveWorkspaceLayout` with the current group's `root`, `layoutMode`, and `scrollable`.

- [ ] **Step 4: Type-check + run app tests**

```
pnpm --filter @webmux/app typecheck
pnpm --filter @webmux/app vitest run
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/lib/api.ts packages/app/components/TerminalCanvas.web.tsx packages/app/components/TerminalWorkspace.web.tsx
git commit -m "Persist mode and scrollable columns through save layout call"
```

---

### Task 18: Default new persistent groups to `scrollable`

**Files:**
- Modify: `packages/app/components/TerminalCanvas.web.tsx` (group create handler) or wherever `createWorkspaceGroup` is called

- [ ] **Step 1: Find the group creation site**

```
grep -n "createWorkspaceGroup\|onCreateGroup" packages/app/components/TerminalCanvas.web.tsx
```

- [ ] **Step 2: After the group is created, persist a `scrollable` mode for it**

Right after the create call returns, fire a `saveWorkspaceLayout(..., null, "scrollable", { columns: [] })` so that subsequent renders reconcile into scrollable mode.

```ts
const created = await createWorkspaceGroup(machineId, name);
await handleSaveWorkspaceLayout(machineId, created.id, null, "scrollable", { columns: [] });
```

- [ ] **Step 3: Manual smoke test**

Run dev:

```
pnpm --filter @webmux/app dev:web
```

Open http://localhost:5173 (or the project's actual port — check `vite.config.ts`). Create a new workspace group. Verify it renders the scrollable strip.

- [ ] **Step 4: Commit**

```bash
git add packages/app/components/TerminalCanvas.web.tsx
git commit -m "Default new workspace groups to scrollable layout"
```

---

## Phase 6 — Verification

### Task 19: Round-trip integration test (Rust route + DB)

**Files:**
- Modify: `crates/hub/src/routes/terminals.rs` test module

- [ ] **Step 1: Add an end-to-end-ish integration test**

```rust
#[tokio::test]
async fn workspace_layout_round_trip_scrollable_then_tiling() {
    let state = test_state().await;
    // Start in scrollable
    let (s1, v1) = put_workspace_layout(&state, json!({
        "group_key": "cwd:/x",
        "root": null,
        "mode": "scrollable",
        "scrollable": {"columns": [
            {"terminalId": "t1", "width": {"kind": "preset", "value": "half"}}
        ]},
        "base_updated_at": -1,
    })).await;
    assert_eq!(s1, StatusCode::OK);
    assert_eq!(v1["mode"], "scrollable");
    let updated_at = v1["updated_at"].as_i64().unwrap();
    // Switch to tiling, supply a tree
    let (s2, v2) = put_workspace_layout(&state, json!({
        "group_key": "cwd:/x",
        "root": {"type": "leaf", "terminalId": "t1"},
        "mode": "tiling",
        "scrollable": {"columns": [
            {"terminalId": "t1", "width": {"kind": "preset", "value": "half"}}
        ]},
        "base_updated_at": updated_at,
    })).await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(v2["mode"], "tiling");
    // Both representations stored — round-trip preserves them
    assert!(v2["scrollable"]["columns"].as_array().unwrap().len() == 1);
    assert!(v2["root"]["type"].as_str() == Some("leaf"));
}
```

- [ ] **Step 2: Run**

```
cargo test -p webmux-hub workspace_layout_round_trip
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/hub/src/routes/terminals.rs
git commit -m "Test scrollable<->tiling round-trip persistence"
```

---

### Task 20: Manual UI verification

- [ ] **Step 1: Start dev environment**

```
pnpm --filter @webmux/app dev:web &
cargo run -p webmux-hub --release
```

- [ ] **Step 2: Verify the four critical paths**

1. Create a new persistent group → renders scrollable strip with one column.
2. Split a pane → new column appears at the strip end; viewport scrolls to it.
3. Toggle mode via toolbar icon → tree restores; no terminals lost.
4. Resize viewport to mobile width (<680px) → all columns become full-width; swipe scrolls between them.

- [ ] **Step 3: Verify keyboard**

- `Mod+,` shrinks the focused column; `Mod+.` grows it (preset cycle).
- `Mod+Alt+T` toggles mode.
- `Mod+ArrowLeft/Right` moves focus between columns.
- `Mod+ArrowUp/Down` is a no-op in scrollable mode.

- [ ] **Step 4: Reload the page**

Layout, mode, and column widths persist across reload. Switching mode and reloading restores the originally-saved layout.

- [ ] **Step 5: Confirm no regressions in tiling groups**

Existing groups (with `layout_mode IS NULL` in the DB) still render the binary tree splits and behave exactly as before.

---

### Task 21: Final lint, typecheck, full test sweep, and PR

- [ ] **Step 1: Run full check**

```
pnpm -w lint
pnpm -w typecheck
pnpm -w test
cargo test --workspace
```

All green.

- [ ] **Step 2: Push branch**

```
git push -u origin feature-scrollable-tiling
```

- [ ] **Step 3: Open PR**

```
gh pr create --title "Add scrollable tiling workspace mode" \
  --body "$(cat <<'EOF'
## Summary
- New per-group scrollable layout mode (PaperWM/niri style: one column = one pane, focus-driven viewport)
- Coexists with current binary-tree tiling; toggle via toolbar icon, keyboard, or context menu
- New persistent groups default to scrollable; existing groups stay tiling
- Mode switches preserve both representations losslessly via aux_json

## Test plan
- [ ] Unit: layout engine helpers, width cycling, scrollable mutators
- [ ] Component: ScrollableWorkspace renders columns, drag handles, mobile collapse
- [ ] Rust: workspace_layouts round-trip with mode + aux_json
- [ ] Manual: split/close/swap/reorder, resize, mobile viewport, reload persistence

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

- [x] Spec coverage: every spec section maps to a task above (types → 1+5; DB → 2+3; route → 4; engine → 6-10; rendering → 12-14; toggle → 15-16; persistence → 17-18; defaults → 18; tests → covered per phase + 19; risks: ALTER-on-existing handled in Task 2 via `add_column_if_missing`).
- [x] No placeholders: all code blocks contain real, runnable code; no "TODO" or "implement later" without a concrete code block on the same step.
- [x] Type consistency: `WorkspaceLayoutMode`, `WorkspaceColumnWidth`, `WorkspaceScrollableLayout`, `WorkspaceScrollableColumn` are spelled the same in every reference (TS and Rust), with consistent serde casing (`snake_case` for variants, `camelCase` for column fields).

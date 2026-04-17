# Nav Redesign + Tabs Within Workpath — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-17-nav-redesign-with-tabs-design.md`

**Goal:** Replace the rail+overlay nav with a VS Code-style activity bar + workpath panel + per-workpath tab strip; restore the tab pattern inside a workpath; add `Cmd+0` shortcut for All view; remove hover/hot-corner triggers.

**Architecture:** Build new components (ActivityBar, WorkpathPanel, TabStrip, WorkpathEmptyState) in parallel without removing the old rail/overlay; flip the wiring in NavColumn + Canvas to use the new pieces; then delete the legacy rail/overlay/breadcrumb files in a final cleanup task. Reducer field rename + localStorage persistence land first so consumers can settle around the new naming early. TDD where the change is testable in vitest (reducer, shortcuts, helpers); Playwright for component behavior (vitest has no jsdom in this repo).

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Playwright (E2E in Docker), pnpm workspaces.

**Active worktree:** `/home/chareice/projects/webmux/all-hot-corner` (branch `all-hot-corner`).

---

## File map

**Create:**
- `packages/app/components/ActivityBar.web.tsx` — 48px left strip; renders nothing when machines.length ≤ 1.
- `packages/app/components/WorkpathPanel.web.tsx` — workpath list with full names; owns add-directory PathInput inline.
- `packages/app/components/TabStrip.web.tsx` — per-workpath tab row + pinned-right region (+ button + quick-cmd chips).
- `packages/app/components/WorkpathEmptyState.web.tsx` — centered empty state with `+ New terminal here` + chips.
- `packages/app/lib/panelOpenStorage.ts` — tiny localStorage helper for `panelOpen` persistence.
- `packages/app/lib/panelOpenStorage.test.ts` — unit test for the helper.
- `e2e/tests/tab-strip.spec.ts` — open 3 terminals in one workpath, click each tab, close one, verify focus moves.
- `e2e/tests/panel-toggle.spec.ts` — Cmd+B closes/opens panel; persists across reload.

**Modify:**
- `packages/app/lib/mainLayoutReducer.ts` — rename `columnForceExpanded` → `panelOpen`; default `true`; (the existing `TOGGLE_NAV_FORCE_EXPANDED` action becomes `TOGGLE_PANEL`); read initial value from localStorage via the new helper.
- `packages/app/lib/mainLayoutReducer.test.ts` — update to assert on `panelOpen` and `TOGGLE_PANEL`.
- `packages/app/lib/shortcuts.ts` — add `Cmd+0` to `isAppShortcut` + the keydown handler; rescope `Cmd+Tab` doc/comments (same code path; the scoping happens in the handler in `TerminalCanvas`).
- `packages/app/components/NavColumn.web.tsx` — strip the rail/overlay logic; render `ActivityBar` + `WorkpathPanel`. Drop the document `pointermove` effect, `collapseAfterAction`, `addDirectoryOpen` prop, `forceExpanded` prop. Take `panelOpen` and `onTogglePanel` instead.
- `packages/app/components/Canvas.web.tsx` — when in workpath scope: render `TabStrip` on top of the terminal area; when in workpath scope with no terminals: render `WorkpathEmptyState`; when in All scope: keep the grid but pass each card a `workpathLabel` prop. Drop `TerminalBreadcrumb` import + render.
- `packages/app/components/TerminalCard.web.tsx` — accept optional `workpathLabel` prop (string); render in the card top-left corner when in `card` displayMode.
- `packages/app/components/TerminalCanvas.web.tsx` — drop `addDirectoryOpen` state; rename layout calls (`columnForceExpanded` → `panelOpen`, `TOGGLE_NAV_FORCE_EXPANDED` → `TOGGLE_PANEL`); add `selectAll` shortcut wiring; add `nextTab`/`prevTab` handler that scopes by current workpath; rewrite `handleSelectWorkpath` to also dispatch `ZOOM_TERMINAL` when the workpath has at least one terminal.
- `e2e/tests/helpers.ts` — replace `expandNavColumn` with `openPanel` helper that ensures the workpath panel is visible (Cmd+B if hidden) and renames testid lookups.
- All e2e specs that reference `data-testid="workpath-rail"`, `data-testid="workpath-overlay"`, `data-testid^="rail-"`, `data-testid^="overlay-"` — replace with the new `workpath-panel` / `panel-bookmark-…` / `tab-…` testids.

**Delete:**
- `packages/app/components/WorkpathRail.web.tsx`
- `packages/app/components/WorkpathOverlay.web.tsx`
- `packages/app/components/TerminalBreadcrumb.web.tsx`
- `packages/app/lib/workpathTag.ts` (only consumer was the rail; abbreviation logic gone)
- `packages/app/lib/workpathTag.test.ts`

---

## Test ids — canonical names (the e2e suite must use these)

Establish these up front so all the tasks line up:

| Component                  | Testid                                  | Notes                                  |
|----------------------------|-----------------------------------------|----------------------------------------|
| ActivityBar root           | `activity-bar`                          | only present when machines.length > 1  |
| ActivityBar machine btn    | `activity-bar-machine-${machineId}`     | one per machine                        |
| ActivityBar `+`            | `activity-bar-add-directory`            | multi-machine only                     |
| ActivityBar `⚙`            | `activity-bar-open-settings`            | multi-machine only                     |
| WorkpathPanel root         | `workpath-panel`                        | always present when panelOpen          |
| WorkpathPanel All row      | `panel-select-all`                      |                                        |
| WorkpathPanel bookmark     | `panel-bookmark-${bookmarkId}`          | also exists for synthetic `local-home` |
| WorkpathPanel remove       | `panel-remove-${bookmarkId}`            |                                        |
| WorkpathPanel add row      | `panel-add-directory`                   |                                        |
| WorkpathPanel `+` (single) | `panel-add-bookmark` (single-machine)   | replaces activity bar `+`              |
| WorkpathPanel `⚙` (single) | `panel-open-settings` (single-machine)  | replaces activity bar `⚙`              |
| Panel "Control Here"       | `panel-request-control-${machineId}`    | shows when not the controller          |
| TabStrip root              | `tab-strip`                             |                                        |
| TabStrip tab               | `tab-${terminalId}`                     | one per terminal in workpath           |
| TabStrip close             | `tab-close-${terminalId}`               |                                        |
| TabStrip `+`               | `tab-new`                               | new blank terminal in workpath         |
| TabStrip quick chip        | `tab-quick-cmd-${commandLabel}`         | one per configured chip                |
| TabStrip overflow `⋯`      | `tab-quick-cmd-more`                    | only when chips > 3                    |
| WorkpathEmptyState root    | `workpath-empty`                        |                                        |
| WorkpathEmptyState `+`     | `workpath-empty-new-terminal`           |                                        |
| WorkpathEmptyState chip    | `workpath-empty-quick-cmd-${label}`     |                                        |
| Card workpath label        | `terminal-card-workpath-label`          | shown only in All grid                 |

---

## Tasks

### Task 1: Reducer — rename `columnForceExpanded` → `panelOpen`, default `true`, add `TOGGLE_PANEL` action

**Files:**
- Modify: `packages/app/lib/mainLayoutReducer.ts`
- Modify: `packages/app/lib/mainLayoutReducer.test.ts`
- Modify: `packages/app/components/TerminalCanvas.web.tsx` (consumer)
- Modify: `packages/app/components/NavColumn.web.tsx` (consumer prop name)

Note: `NavColumn` and `WorkpathOverlay` are about to be replaced wholesale — but we still rename their existing `forceExpanded` prop in this task so the codebase stays compilable between tasks. Their full rewrite is later.

- [ ] **Step 1: Update reducer test (failing)**

Edit `packages/app/lib/mainLayoutReducer.test.ts`. Replace the three places it references `columnForceExpanded`/`TOGGLE_NAV_FORCE_EXPANDED`:

```ts
it("starts with All selected and no zoomed terminal, panel open", () => {
  expect(initial.selectedWorkpathId).toBe("all");
  expect(initial.zoomedTerminalId).toBeNull();
  expect(initial.panelOpen).toBe(true);
});

// ...within the file, also add (or rewrite the existing toggle test):
it("TOGGLE_PANEL flips panelOpen", () => {
  const closed = mainLayoutReducer(initial, { type: "TOGGLE_PANEL" });
  expect(closed.panelOpen).toBe(false);
  const open = mainLayoutReducer(closed, { type: "TOGGLE_PANEL" });
  expect(open.panelOpen).toBe(true);
});
```

Search the file for the old token-by-token to fix any other assertions and remove the old `TOGGLE_NAV_FORCE_EXPANDED` test if present.

- [ ] **Step 2: Run test, verify failure**

```bash
cd /home/chareice/projects/webmux/all-hot-corner
pnpm test -- mainLayoutReducer 2>&1 | tail -10
```

Expected: TS compile errors AND test failures referencing `panelOpen` / `TOGGLE_PANEL` not existing on the type / state.

- [ ] **Step 3: Update the reducer**

Edit `packages/app/lib/mainLayoutReducer.ts`:

```ts
export type WorkpathSelection = "all" | string;

export interface MainLayoutState {
  selectedWorkpathId: WorkpathSelection;
  zoomedTerminalId: string | null;
  panelOpen: boolean;
}

export type MainLayoutAction =
  | { type: "SELECT_WORKPATH"; workpathId: WorkpathSelection }
  | { type: "ZOOM_TERMINAL"; terminalId: string }
  | { type: "UNZOOM" }
  | { type: "TERMINAL_CREATED"; terminalId: string; workpathId: WorkpathSelection }
  | { type: "TERMINAL_DESTROYED"; terminalId: string }
  | { type: "WORKPATH_DELETED"; workpathId: string }
  | { type: "TOGGLE_PANEL" };

export function createInitialMainLayout(): MainLayoutState {
  return {
    selectedWorkpathId: "all",
    zoomedTerminalId: null,
    panelOpen: true,
  };
}

export function mainLayoutReducer(
  state: MainLayoutState,
  action: MainLayoutAction,
): MainLayoutState {
  switch (action.type) {
    case "SELECT_WORKPATH":
      return {
        ...state,
        selectedWorkpathId: action.workpathId,
        zoomedTerminalId: null,
      };
    case "ZOOM_TERMINAL":
      return { ...state, zoomedTerminalId: action.terminalId };
    case "UNZOOM":
      return { ...state, zoomedTerminalId: null };
    case "TERMINAL_CREATED":
      return {
        ...state,
        selectedWorkpathId: action.workpathId,
        zoomedTerminalId: action.terminalId,
      };
    case "TERMINAL_DESTROYED":
      if (state.zoomedTerminalId === action.terminalId) {
        return { ...state, zoomedTerminalId: null };
      }
      return state;
    case "WORKPATH_DELETED":
      if (state.selectedWorkpathId === action.workpathId) {
        return { ...state, selectedWorkpathId: "all", zoomedTerminalId: null };
      }
      return state;
    case "TOGGLE_PANEL":
      return { ...state, panelOpen: !state.panelOpen };
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
```

- [ ] **Step 4: Update consumers — TerminalCanvas + NavColumn**

In `packages/app/components/TerminalCanvas.web.tsx`, search and replace:
- `layout.columnForceExpanded` → `layout.panelOpen`
- `dispatchLayout({ type: "TOGGLE_NAV_FORCE_EXPANDED" })` → `dispatchLayout({ type: "TOGGLE_PANEL" })`

For the `navColumnProps` literal:
- `forceExpanded: layout.columnForceExpanded` → `panelOpen: layout.panelOpen`

In `packages/app/components/NavColumn.web.tsx`, the prop name needs to change too: `forceExpanded` → `panelOpen`. Update the interface, the destructuring, and the usage in the `expanded` derivation. (Whole file is being replaced in Task 5; keep this minimal — just the rename.)

In `packages/app/components/WorkpathOverlay.web.tsx` — no changes needed; it doesn't reference the field.

- [ ] **Step 5: Verify typecheck + tests**

```bash
pnpm typecheck 2>&1 | tail -5
pnpm test 2>&1 | tail -10
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/lib/mainLayoutReducer.ts \
        packages/app/lib/mainLayoutReducer.test.ts \
        packages/app/components/TerminalCanvas.web.tsx \
        packages/app/components/NavColumn.web.tsx
git commit -m "refactor(layout): rename columnForceExpanded → panelOpen, default true"
```

---

### Task 2: localStorage helper for `panelOpen` persistence

**Files:**
- Create: `packages/app/lib/panelOpenStorage.ts`
- Create: `packages/app/lib/panelOpenStorage.test.ts`
- Modify: `packages/app/lib/mainLayoutReducer.ts` (use helper in `createInitialMainLayout`)

- [ ] **Step 1: Write the failing tests**

Create `packages/app/lib/panelOpenStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readPanelOpen, writePanelOpen, PANEL_OPEN_KEY } from "./panelOpenStorage";

describe("panelOpenStorage", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });

  it("returns the default when nothing is stored", () => {
    expect(readPanelOpen(true)).toBe(true);
    expect(readPanelOpen(false)).toBe(false);
  });

  it("returns the stored value when present", () => {
    store[PANEL_OPEN_KEY] = "false";
    expect(readPanelOpen(true)).toBe(false);
    store[PANEL_OPEN_KEY] = "true";
    expect(readPanelOpen(false)).toBe(true);
  });

  it("returns the default when the stored value is malformed", () => {
    store[PANEL_OPEN_KEY] = "garbage";
    expect(readPanelOpen(true)).toBe(true);
  });

  it("writePanelOpen persists the value", () => {
    writePanelOpen(false);
    expect(store[PANEL_OPEN_KEY]).toBe("false");
    writePanelOpen(true);
    expect(store[PANEL_OPEN_KEY]).toBe("true");
  });

  it("returns the default when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("disabled"); },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readPanelOpen(true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
pnpm test -- panelOpenStorage 2>&1 | tail -10
```

Expected: file not found / no exports.

- [ ] **Step 3: Implement the helper**

Create `packages/app/lib/panelOpenStorage.ts`:

```ts
export const PANEL_OPEN_KEY = "webmux:panel-open";

// Persists the workpath-panel open/closed state across reloads. Falls back
// to the caller-supplied default if storage is unavailable (Tauri WebView
// in some configs, private mode, throwing localStorage stub) or the value
// is malformed.
export function readPanelOpen(defaultValue: boolean): boolean {
  try {
    const raw = (globalThis.localStorage ?? null)?.getItem(PANEL_OPEN_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writePanelOpen(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(PANEL_OPEN_KEY, value ? "true" : "false");
  } catch {
    /* storage unavailable — silently drop */
  }
}
```

- [ ] **Step 4: Wire into reducer init**

Edit `packages/app/lib/mainLayoutReducer.ts`:

```ts
import { readPanelOpen } from "./panelOpenStorage";

// ...
export function createInitialMainLayout(): MainLayoutState {
  return {
    selectedWorkpathId: "all",
    zoomedTerminalId: null,
    panelOpen: readPanelOpen(true),
  };
}
```

- [ ] **Step 5: Persist on TOGGLE_PANEL**

The reducer is a pure function — it can't write to storage. Persist from the side that owns the dispatch. Edit `packages/app/components/TerminalCanvas.web.tsx`. Find `useShortcuts({ … toggleNav: () => dispatchLayout({ type: "TOGGLE_PANEL" }) })` (renamed in Task 1) and wrap it:

```ts
toggleNav: () => {
  const next = !layout.panelOpen;
  writePanelOpen(next);
  dispatchLayout({ type: "TOGGLE_PANEL" });
},
```

Add the import at the top:

```ts
import { writePanelOpen } from "@/lib/panelOpenStorage";
```

- [ ] **Step 6: Verify**

```bash
pnpm typecheck 2>&1 | tail -3
pnpm test 2>&1 | tail -8
```

Expected: typecheck clean, 5 new tests pass + existing ones still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/app/lib/panelOpenStorage.ts \
        packages/app/lib/panelOpenStorage.test.ts \
        packages/app/lib/mainLayoutReducer.ts \
        packages/app/components/TerminalCanvas.web.tsx
git commit -m "feat(layout): persist panelOpen across reloads via localStorage"
```

---

### Task 3: Shortcuts — add `Cmd+0` for All; document `Cmd+Tab` workpath-scoped

**Files:**
- Modify: `packages/app/lib/shortcuts.ts`

`Cmd+Tab`'s scoping (workpath-bounded) is implemented by the *handler* — `nextTab`/`prevTab` callbacks in `TerminalCanvas` will compute the next sibling within the active workpath. The shortcuts module just relays the keystroke. We add the `Cmd+0` case + `selectAll` action; tab next/prev cases stay where they are (they already exist).

- [ ] **Step 1: Edit `packages/app/lib/shortcuts.ts`**

Add `selectAll` to the `ShortcutActions` interface:

```ts
interface ShortcutActions {
  newTerminal?: () => void;
  closeTab?: () => void;
  closePane?: () => void;
  nextTab?: () => void;
  prevTab?: () => void;
  selectTab?: (index: number) => void;
  selectAll?: () => void;          // <— NEW
  splitVertical?: () => void;
  splitHorizontal?: () => void;
  focusPrevPane?: () => void;
  focusNextPane?: () => void;
  toggleNav?: () => void;
}
```

Add `Digit0` to `isAppShortcut`:

```ts
export function isAppShortcut(event: KeyboardEvent): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return false;

  if (event.shiftKey && event.code === "KeyT") return true;
  if (!event.shiftKey && event.code === "KeyW") return true;
  if (event.shiftKey && event.code === "KeyW") return true;
  if (!event.shiftKey && event.code === "Backslash") return true;
  if (event.shiftKey && event.code === "Backslash") return true;
  if (event.shiftKey && event.code === "BracketLeft") return true;
  if (event.shiftKey && event.code === "BracketRight") return true;
  if (!event.shiftKey && event.code === "Digit0") return true;        // <— NEW
  if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") return true;
  if (event.key === "Tab") return true;
  if (!event.shiftKey && event.code === "KeyB") return true;

  return false;
}
```

In the `handler` inside `useShortcuts`, add a branch for `Digit0` BEFORE the `Digit1..Digit9` branch:

```ts
if (!event.shiftKey && event.code === "Digit0") {
  event.preventDefault();
  a.selectAll?.();
  return;
}

if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") {
  event.preventDefault();
  const index = parseInt(event.code.replace("Digit", ""), 10) - 1;
  a.selectTab?.(index);
  return;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

Expected: clean (no consumer wired up yet — that's the next task — but the type addition is backwards-compat because the prop is optional).

- [ ] **Step 3: Commit**

```bash
git add packages/app/lib/shortcuts.ts
git commit -m "feat(shortcuts): add Cmd+0 → selectAll"
```

---

### Task 4: New `ActivityBar` component

**Files:**
- Create: `packages/app/components/ActivityBar.web.tsx`

This component is presentational; no consumers wire it up yet (Task 7 will).

- [ ] **Step 1: Create the file**

```tsx
import { memo } from "react";
import type { MachineInfo } from "@webmux/shared";
import { Plus, Settings } from "lucide-react";
import { colors } from "@/lib/colors";

interface ActivityBarProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  onSelectMachine: (id: string) => void;
  onAddBookmark: () => void;
  onOpenSettings: () => void;
}

// Visible only with multiple machines. Single-machine users get the global
// actions in the WorkpathPanel footer instead — see WorkpathPanel for the
// fallback rendering.
function ActivityBarComponent(props: ActivityBarProps) {
  const { machines, activeMachineId, onSelectMachine, onAddBookmark, onOpenSettings } = props;
  if (machines.length <= 1) return null;

  const machineBadgeText = (m: MachineInfo) =>
    m.name.length <= 5 ? m.name : m.name.slice(0, 2).toLowerCase();

  return (
    <div
      data-testid="activity-bar"
      style={{
        width: 48,
        minWidth: 48,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        paddingTop: 8,
        paddingBottom: 8,
        height: "100%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingInline: 8 }}>
        {machines.map((m) => {
          const selected = m.id === activeMachineId;
          return (
            <button
              key={m.id}
              data-testid={`activity-bar-machine-${m.id}`}
              onClick={() => onSelectMachine(m.id)}
              title={m.name}
              style={{
                background: selected ? colors.accent : colors.backgroundSecondary,
                color: selected ? colors.background : colors.accent,
                border: "none",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              {machineBadgeText(m)}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          paddingTop: 8,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <button
          data-testid="activity-bar-add-directory"
          onClick={onAddBookmark}
          title="Add directory"
          style={iconBtn}
          aria-label="Add directory"
        >
          <Plus size={14} />
        </button>
        <button
          data-testid="activity-bar-open-settings"
          onClick={onOpenSettings}
          title="Settings"
          style={iconBtn}
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: colors.foregroundMuted,
  cursor: "pointer",
  padding: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const ActivityBar = memo(ActivityBarComponent);
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/ActivityBar.web.tsx
git commit -m "feat(ui): ActivityBar component (machines + global actions)"
```

---

### Task 5: New `WorkpathPanel` component

**Files:**
- Create: `packages/app/components/WorkpathPanel.web.tsx`

This is the substantive replacement for the old overlay. It owns the bookmark list, the inline `PathInput`, the request-control button, and (when single-machine) the bottom + and ⚙ actions. Bookmarks come in via props from `TerminalCanvas` (already lifted there in PR #137); the panel mirrors the same callback shape.

- [ ] **Step 1: Create the file**

```tsx
import { memo, useState } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { Plus, Settings, X } from "lucide-react";
import { colors } from "@/lib/colors";
import { PathInput } from "./PathInput.web";

interface WorkpathPanelProps {
  machine: MachineInfo;
  // True when this user holds the device's machine lease — gates "Control Here".
  canCreateTerminal: boolean;
  // True when only one machine is registered → render footer actions here
  // instead of relying on the (hidden) ActivityBar.
  singleMachine: boolean;
  bookmarks: Bookmark[];
  selectedWorkpathId: string | "all";
  terminals: TerminalInfo[];
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onOpenSettings: () => void;
}

function matchBookmark(bm: Bookmark, t: TerminalInfo): boolean {
  return t.machine_id === bm.machine_id && t.cwd === bm.path;
}

function WorkpathPanelComponent(props: WorkpathPanelProps) {
  const {
    machine,
    canCreateTerminal,
    singleMachine,
    bookmarks,
    selectedWorkpathId,
    terminals,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onConfirmAddDirectory,
    onRemoveBookmark,
    onOpenSettings,
  } = props;

  // Owned locally — opening / closing the inline PathInput is a panel
  // concern, not a TerminalCanvas concern. Lifted before (PR #137) only to
  // share with the rail "+", which no longer exists.
  const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);

  const machineBookmarks = bookmarks.filter((b) => b.machine_id === machine.id);
  const totalCount = terminals.filter((t) => t.machine_id === machine.id).length;

  const handleAdd = (path: string) => {
    if (!path) {
      setAddDirectoryOpen(false);
      return;
    }
    if (machineBookmarks.some((b) => b.path === path)) {
      setAddDirectoryOpen(false);
      return;
    }
    onConfirmAddDirectory(machine.id, path);
    setAddDirectoryOpen(false);
  };

  return (
    <div
      data-testid="workpath-panel"
      style={{
        width: 220,
        minWidth: 220,
        flexShrink: 0,
        background: colors.backgroundSecondary,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: colors.foregroundMuted,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {singleMachine ? "Workpaths" : "Machine"}
        </div>
        {!singleMachine && (
          <div style={{ fontSize: 12, color: colors.foreground, marginTop: 2 }}>
            {machine.name} · {machine.os}
          </div>
        )}
      </div>

      {!canCreateTerminal && onRequestControl && (
        <div style={{ padding: 10 }}>
          <button
            data-testid={`panel-request-control-${machine.id}`}
            onClick={() => onRequestControl(machine.id)}
            style={{
              background: colors.accent,
              color: colors.background,
              border: "none",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 10px",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Control Here
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        <button
          data-testid="panel-select-all"
          onClick={onSelectAll}
          style={rowStyle(selectedWorkpathId === "all")}
        >
          <span style={{ color: colors.foreground, fontSize: 12 }}>All</span>
          {totalCount > 0 && (
            <span style={{ color: colors.foregroundMuted, fontSize: 10 }}>{totalCount}</span>
          )}
        </button>

        <div style={{ height: 1, background: colors.border, margin: "4px 12px" }} />

        {machineBookmarks.map((bm) => {
          const selected = selectedWorkpathId === bm.id;
          const count = terminals.filter((t) => matchBookmark(bm, t)).length;
          const live = count > 0;
          return (
            <div key={bm.id} style={{ ...rowStyle(selected), paddingBottom: 8, position: "relative" }}>
              <button
                data-testid={`panel-bookmark-${bm.id}`}
                onClick={() => {
                  if (!canCreateTerminal && count === 0) return;
                  if (count === 0) {
                    onCreateTerminal(machine.id, bm.path);
                  } else {
                    onSelectWorkpath(bm.id);
                  }
                }}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  alignItems: "stretch",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span
                    style={{
                      color: selected ? colors.accent : colors.foreground,
                      fontSize: 12,
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {bm.label}
                  </span>
                  <span style={{ color: colors.foregroundMuted, fontSize: 10 }}>
                    {count > 0 ? `${count} ${live ? "●" : ""}` : ""}
                  </span>
                </div>
                <div style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 1 }}>
                  {bm.path}
                </div>
              </button>
              <button
                data-testid={`panel-remove-${bm.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBookmark(bm.id);
                }}
                style={{
                  position: "absolute",
                  right: 8,
                  top: 6,
                  background: "none",
                  border: "none",
                  color: colors.foregroundMuted,
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label="Remove bookmark"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}

        {addDirectoryOpen ? (
          <PathInput
            machineId={machine.id}
            onSubmit={handleAdd}
            onCancel={() => setAddDirectoryOpen(false)}
          />
        ) : (
          <button
            data-testid="panel-add-directory"
            onClick={() => setAddDirectoryOpen(true)}
            style={{
              background: "none",
              border: "none",
              color: colors.foregroundMuted,
              cursor: "pointer",
              padding: "8px 12px",
              fontSize: 11,
              textAlign: "left",
              width: "100%",
            }}
          >
            + Add directory
          </button>
        )}
      </div>

      {singleMachine && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 4,
            padding: "6px 10px",
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <button
            data-testid="panel-add-bookmark"
            onClick={() => setAddDirectoryOpen(true)}
            title="Add directory"
            style={iconBtn}
            aria-label="Add directory"
          >
            <Plus size={14} />
          </button>
          <button
            data-testid="panel-open-settings"
            onClick={onOpenSettings}
            title="Settings"
            style={iconBtn}
            aria-label="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function rowStyle(selected: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    background: selected ? "rgba(217, 119, 87, 0.08)" : "transparent",
    borderLeft: selected ? `2px solid ${colors.accent}` : "2px solid transparent",
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textAlign: "left",
  };
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: colors.foregroundMuted,
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const WorkpathPanel = memo(WorkpathPanelComponent);
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/WorkpathPanel.web.tsx
git commit -m "feat(ui): WorkpathPanel — workpath list with full names + inline add"
```

---

### Task 6: New `TabStrip` component

**Files:**
- Create: `packages/app/components/TabStrip.web.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { memo, useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Plus, X, MoreHorizontal } from "lucide-react";
import { colors } from "@/lib/colors";

export interface QuickCommand {
  label: string;
  command: string;
}

interface TabStripProps {
  // Terminals belonging to the active workpath, in creation order.
  tabs: TerminalInfo[];
  // The terminal currently visible. May not equal any tab.id when a fallback
  // is being shown (workpath has terminals but no explicit zoom yet) — the
  // first tab is highlighted instead.
  activeTabId: string | null;
  canCreateTerminal: boolean;
  quickCommands: QuickCommand[];
  onSelectTab: (terminalId: string) => void;
  onCloseTab: (terminal: TerminalInfo) => void;
  onNewTerminal: () => void;
  onQuickCommand: (command: string) => void;
}

const MAX_INLINE_CHIPS = 3;

function TabStripComponent(props: TabStripProps) {
  const {
    tabs,
    activeTabId,
    canCreateTerminal,
    quickCommands,
    onSelectTab,
    onCloseTab,
    onNewTerminal,
    onQuickCommand,
  } = props;

  // Effective active id — falls back to the first tab when the parent has
  // no explicit zoom yet. See the spec's Canvas state table.
  const effectiveActive = activeTabId ?? tabs[0]?.id ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);

  // Wheel-to-horizontal scroll — same trick used elsewhere in the project
  // for mouse users without a horizontal trackpad.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      // Only intercept when the strip actually has overflow.
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Auto-scroll the active tab into view.
  useEffect(() => {
    if (!effectiveActive) return;
    const tabEl = scrollRef.current?.querySelector(
      `[data-testid="tab-${effectiveActive}"]`,
    ) as HTMLElement | null;
    tabEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [effectiveActive]);

  const visibleChips = quickCommands.filter((c) => c.label && c.command);
  const inlineChips = visibleChips.slice(0, MAX_INLINE_CHIPS);
  const overflowChips = visibleChips.slice(MAX_INLINE_CHIPS);
  const [overflowOpen, setOverflowOpen] = useState(false);

  return (
    <div
      data-testid="tab-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        height: 32,
        flexShrink: 0,
      }}
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "stretch",
          gap: 1,
          paddingLeft: 8,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((t) => {
          const isActive = effectiveActive === t.id;
          const live = true; // placeholder — no per-tab live signal yet
          return (
            <div
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => onSelectTab(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: isActive ? colors.background : "transparent",
                borderTop: isActive
                  ? `2px solid ${colors.accent}`
                  : "2px solid transparent",
                borderLeft: `1px solid ${colors.border}`,
                borderRight: `1px solid ${colors.border}`,
                padding: "0 10px",
                color: isActive ? colors.foreground : colors.foregroundSecondary,
                cursor: "pointer",
                fontSize: 11,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: live ? colors.accent : colors.foregroundMuted,
                  flexShrink: 0,
                }}
              />
              <span>{t.title || t.id.slice(0, 8)}</span>
              <button
                data-testid={`tab-close-${t.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.foregroundMuted,
                  cursor: "pointer",
                  padding: 2,
                  display: "inline-flex",
                  alignItems: "center",
                }}
                aria-label="Close terminal"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          borderLeft: `1px solid ${colors.border}`,
          flexShrink: 0,
          background: colors.surface,
        }}
      >
        {canCreateTerminal && (
          <>
            <button
              data-testid="tab-new"
              onClick={onNewTerminal}
              title="New terminal"
              aria-label="New terminal"
              style={{
                background: "none",
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                color: colors.foregroundMuted,
                cursor: "pointer",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <Plus size={12} />
            </button>
            {inlineChips.map((cmd) => (
              <button
                key={cmd.label}
                data-testid={`tab-quick-cmd-${cmd.label}`}
                onClick={() => onQuickCommand(cmd.command)}
                style={{
                  background: "rgba(217, 119, 87, 0.12)",
                  color: colors.accent,
                  border: "1px solid rgba(217, 119, 87, 0.3)",
                  borderRadius: 4,
                  fontSize: 10,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {cmd.label}
              </button>
            ))}
            {overflowChips.length > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  data-testid="tab-quick-cmd-more"
                  onClick={() => setOverflowOpen((v) => !v)}
                  title="More quick commands"
                  aria-label="More quick commands"
                  style={{
                    background: "none",
                    border: `1px solid ${colors.border}`,
                    borderRadius: 4,
                    color: colors.foregroundMuted,
                    cursor: "pointer",
                    padding: "2px 6px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <MoreHorizontal size={12} />
                </button>
                {overflowOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      background: colors.backgroundSecondary,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                      zIndex: 50,
                      minWidth: 120,
                    }}
                  >
                    {overflowChips.map((cmd) => (
                      <button
                        key={cmd.label}
                        data-testid={`tab-quick-cmd-${cmd.label}`}
                        onClick={() => {
                          setOverflowOpen(false);
                          onQuickCommand(cmd.command);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: colors.accent,
                          cursor: "pointer",
                          padding: "6px 10px",
                          fontSize: 11,
                          textAlign: "left",
                          width: "100%",
                          display: "block",
                        }}
                      >
                        {cmd.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const TabStrip = memo(TabStripComponent);
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/TabStrip.web.tsx
git commit -m "feat(ui): TabStrip — per-workpath tabs + pinned chips region"
```

---

### Task 7: New `WorkpathEmptyState` component

**Files:**
- Create: `packages/app/components/WorkpathEmptyState.web.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { memo } from "react";
import type { Bookmark } from "@webmux/shared";
import { colors } from "@/lib/colors";
import type { QuickCommand } from "./TabStrip.web";

interface WorkpathEmptyStateProps {
  bookmark: Bookmark;
  canCreateTerminal: boolean;
  quickCommands: QuickCommand[];
  onNewTerminal: () => void;
  onQuickCommand: (command: string) => void;
}

function WorkpathEmptyStateComponent({
  bookmark,
  canCreateTerminal,
  quickCommands,
  onNewTerminal,
  onQuickCommand,
}: WorkpathEmptyStateProps) {
  const visibleChips = quickCommands.filter((c) => c.label && c.command);
  return (
    <div
      data-testid="workpath-empty"
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ color: colors.foreground, fontSize: 14, marginBottom: 4 }}>
          {bookmark.label}
        </div>
        <div
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            marginBottom: 18,
            wordBreak: "break-all",
          }}
        >
          {bookmark.path}
        </div>
        {canCreateTerminal ? (
          <>
            <button
              data-testid="workpath-empty-new-terminal"
              onClick={onNewTerminal}
              style={{
                background: colors.accent,
                color: colors.background,
                border: "none",
                borderRadius: 4,
                padding: "8px 16px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + New terminal here
            </button>
            <div style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 8 }}>
              Cmd/Ctrl+Shift+T
            </div>
            {visibleChips.length > 0 && (
              <>
                <div
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginTop: 24,
                    marginBottom: 8,
                  }}
                >
                  Quick commands
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {visibleChips.map((cmd) => (
                    <button
                      key={cmd.label}
                      data-testid={`workpath-empty-quick-cmd-${cmd.label}`}
                      onClick={() => onQuickCommand(cmd.command)}
                      style={{
                        background: "rgba(217, 119, 87, 0.12)",
                        color: colors.accent,
                        border: "1px solid rgba(217, 119, 87, 0.3)",
                        borderRadius: 4,
                        fontSize: 10,
                        padding: "4px 10px",
                        cursor: "pointer",
                      }}
                    >
                      {cmd.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            Take control of this machine to start a terminal.
          </div>
        )}
      </div>
    </div>
  );
}

export const WorkpathEmptyState = memo(WorkpathEmptyStateComponent);
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/WorkpathEmptyState.web.tsx
git commit -m "feat(ui): WorkpathEmptyState — empty workpath canvas"
```

---

### Task 8: Refactor `NavColumn` — render `ActivityBar` + `WorkpathPanel`

**Files:**
- Modify: `packages/app/components/NavColumn.web.tsx` (full rewrite)

This task replaces the rail/overlay wiring inside `NavColumn`. The old rail/overlay files stay on disk for now — Task 14 deletes them. After this task, they're unreferenced.

- [ ] **Step 1: Replace `NavColumn.web.tsx` with the new wiring**

```tsx
import { memo } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { ActivityBar } from "./ActivityBar.web";
import { WorkpathPanel } from "./WorkpathPanel.web";

interface NavColumnProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  bookmarks: Bookmark[];
  terminals: TerminalInfo[];
  selectedWorkpathId: string | "all";
  panelOpen: boolean;
  canCreateTerminalForActiveMachine: boolean;
  onSelectMachine: (id: string) => void;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onOpenSettings: () => void;
}

function NavColumnComponent(props: NavColumnProps) {
  const {
    machines,
    activeMachineId,
    bookmarks,
    terminals,
    selectedWorkpathId,
    panelOpen,
    canCreateTerminalForActiveMachine,
    onSelectMachine,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onConfirmAddDirectory,
    onRemoveBookmark,
    onOpenSettings,
  } = props;

  const activeMachine =
    machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;

  if (!activeMachine) return null;

  const singleMachine = machines.length <= 1;

  // The panel can be hidden via Cmd+B; the activity bar (when present)
  // stays visible regardless. With single-machine the activity bar is
  // hidden too — when panelOpen is false there's no nav surface visible.
  return (
    <div
      data-testid="nav-column"
      style={{ display: "flex", height: "100%" }}
    >
      <ActivityBar
        machines={machines}
        activeMachineId={activeMachineId}
        onSelectMachine={onSelectMachine}
        onAddBookmark={() => {/* opening add-directory is handled by panel directly */}}
        onOpenSettings={onOpenSettings}
      />
      {panelOpen && (
        <WorkpathPanel
          machine={activeMachine}
          canCreateTerminal={canCreateTerminalForActiveMachine}
          singleMachine={singleMachine}
          bookmarks={bookmarks}
          selectedWorkpathId={selectedWorkpathId}
          terminals={terminals}
          onSelectAll={onSelectAll}
          onSelectWorkpath={onSelectWorkpath}
          onCreateTerminal={onCreateTerminal}
          onRequestControl={onRequestControl}
          onConfirmAddDirectory={onConfirmAddDirectory}
          onRemoveBookmark={onRemoveBookmark}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
}

export const NavColumn = memo(NavColumnComponent);
```

The `ActivityBar`'s `onAddBookmark` is currently a no-op because, in the multi-machine activity-bar, opening the add-directory PathInput is handled by *flipping the panel state inside WorkpathPanel*. The activity bar's `+` icon needs to instruct the panel — Task 9 wires this up via a prop.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: errors in `TerminalCanvas.web.tsx` because props it passes are now stale (`addDirectoryOpen`, `forceExpanded`, `quickCommands` to NavColumn). That's fine — Task 9 fixes them. If errors are localized to TerminalCanvas, proceed; if NavColumn itself is broken, fix and re-check.

- [ ] **Step 3: Commit**

```bash
git add packages/app/components/NavColumn.web.tsx
git commit -m "refactor(ui): NavColumn renders ActivityBar + WorkpathPanel"
```

---

### Task 9: Update `TerminalCanvas` — drop dead props, wire new shortcuts, auto-zoom on workpath select

**Files:**
- Modify: `packages/app/components/TerminalCanvas.web.tsx`

After this task, the codebase compiles end-to-end with the new nav.

- [ ] **Step 1: Drop `addDirectoryOpen` state**

In `packages/app/components/TerminalCanvas.web.tsx`, remove:
- `const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);`
- The `addDirectoryOpen` field in `navColumnProps`
- `setAddDirectoryOpen(true)` calls inside `handleNewTerminalFromOverview` (the empty-state button replaces this) and `onAddBookmark`
- The `onCancelAddDirectory` callback

`handleNewTerminalFromOverview` becomes:

```ts
const handleNewTerminalFromOverview = useCallback(async () => {
  if (!activeMachine || !deviceId) return;
  if (!isMachineController(activeMachine.id)) return;
  if (layout.selectedWorkpathId === "all") {
    // From All scope, new-terminal needs a target dir. Fall back to home.
    await handleCreateTerminal(activeMachine.id, activeMachine.home_dir || "~");
    return;
  }
  const bookmark = bookmarks.find((b) => b.id === layout.selectedWorkpathId);
  if (!bookmark) {
    await handleCreateTerminal(activeMachine.id, activeMachine.home_dir || "~");
    return;
  }
  await handleCreateTerminal(bookmark.machine_id, bookmark.path);
}, [
  activeMachine,
  deviceId,
  isMachineController,
  handleCreateTerminal,
  layout.selectedWorkpathId,
  bookmarks,
]);
```

- [ ] **Step 2: Rewrite `handleSelectWorkpath` to auto-zoom**

Add this helper alongside the other dispatchers:

```ts
const handleSelectWorkpath = useCallback(
  (id: string) => {
    if (id === "all") {
      dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" });
      return;
    }
    const bookmark = bookmarks.find((b) => b.id === id);
    const firstTerminal = bookmark
      ? terminals.find(
          (t) => t.machine_id === bookmark.machine_id && t.cwd === bookmark.path,
        )
      : undefined;
    dispatchLayout({ type: "SELECT_WORKPATH", workpathId: id });
    if (firstTerminal) {
      dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: firstTerminal.id });
    }
  },
  [bookmarks, terminals],
);
```

In `navColumnProps`, replace:
- `onSelectWorkpath: (id: string) => dispatchLayout({ type: "SELECT_WORKPATH", workpathId: id }),`
- with: `onSelectWorkpath: handleSelectWorkpath,`

Same for `handleSelectWorkpathByIndex` and the canvas's existing `onSelectWorkpath` (if used). Pass `handleSelectWorkpath` through Canvas props if needed; if Canvas only consumes `selectedWorkpathId` and dispatches via callback, replace dispatch with the helper.

- [ ] **Step 3: Wire `selectAll` shortcut**

In the `useShortcuts({ ... })` block, add:

```ts
selectAll: () => {
  dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" });
  if (window.location.hash.startsWith("#/t/")) {
    window.history.pushState(null, "", window.location.pathname);
  }
},
```

Note this also clears the URL hash so `Cmd+0` consistently lands the user on the All grid.

- [ ] **Step 4: Rescope `nextTab` / `prevTab` to current workpath**

In the `useShortcuts({ ... })` block, replace the existing (currently `undefined`) `nextTab`/`prevTab`:

```ts
nextTab: () => {
  const scoped = currentWorkpathTerminals();
  if (scoped.length <= 1) return;
  const idx = scoped.findIndex((t) => t.id === layout.zoomedTerminalId);
  const nextIdx = (idx === -1 ? 0 : idx + 1) % scoped.length;
  dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: scoped[nextIdx].id });
},
prevTab: () => {
  const scoped = currentWorkpathTerminals();
  if (scoped.length <= 1) return;
  const idx = scoped.findIndex((t) => t.id === layout.zoomedTerminalId);
  const prevIdx = (idx === -1 ? 0 : (idx - 1 + scoped.length) % scoped.length);
  dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: scoped[prevIdx].id });
},
```

Add the helper above the `useShortcuts` block:

```ts
const currentWorkpathTerminals = useCallback((): TerminalInfo[] => {
  if (layout.selectedWorkpathId === "all") return terminals;
  const bookmark = bookmarks.find((b) => b.id === layout.selectedWorkpathId);
  if (!bookmark) return [];
  return terminals.filter(
    (t) => t.machine_id === bookmark.machine_id && t.cwd === bookmark.path,
  );
}, [layout.selectedWorkpathId, terminals, bookmarks]);
```

- [ ] **Step 5: Strip stale NavColumn props**

The `navColumnProps` literal must match the new `NavColumn` interface from Task 8. Final shape:

```ts
const navColumnProps = {
  machines,
  activeMachineId,
  bookmarks,
  terminals,
  selectedWorkpathId: layout.selectedWorkpathId,
  panelOpen: layout.panelOpen,
  canCreateTerminalForActiveMachine: isActiveController,
  onSelectMachine: (id: string) => setActiveMachineId(id),
  onSelectAll: () =>
    dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" }),
  onSelectWorkpath: handleSelectWorkpath,
  onCreateTerminal: handleCreateTerminal,
  onRequestControl: handleRequestControl,
  onConfirmAddDirectory: async (machineId: string, path: string) => {
    const label = (() => {
      const parts = path.replace(/\/+$/, "").split("/");
      return parts[parts.length - 1] || path;
    })();
    try {
      const bm = await createBookmark(machineId, path, label);
      setBookmarks((prev) => [...prev, bm]);
    } catch {
      setBookmarks((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          machine_id: machineId,
          path,
          label,
          sort_order: prev.length,
        },
      ]);
    }
  },
  onRemoveBookmark: async (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    dispatchLayout({ type: "WORKPATH_DELETED", workpathId: id });
    if (id.startsWith("local-")) return;
    try {
      await deleteBookmark(id);
    } catch {
      /* leave optimistic removal in place */
    }
  },
  onOpenSettings: () => setShowSettings(true),
};
```

- [ ] **Step 6: Verify typecheck + tests**

```bash
pnpm typecheck 2>&1 | tail -10
pnpm test 2>&1 | tail -10
```

Expected: typecheck clean (any leftover `forceExpanded` / `addDirectoryOpen` references → fix). Vitest stays green.

- [ ] **Step 7: Commit**

```bash
git add packages/app/components/TerminalCanvas.web.tsx
git commit -m "refactor(canvas): wire new nav, add Cmd+0 / scoped Cmd+Tab, auto-zoom on workpath select"
```

---

### Task 10: Wire `TabStrip` and `WorkpathEmptyState` into `Canvas`

**Files:**
- Modify: `packages/app/components/Canvas.web.tsx`
- Modify: `packages/app/components/TerminalCard.web.tsx` (workpathLabel prop)

This is the substantive Canvas rewire. The change is concentrated in the existing return JSX; pane-layout machinery and hidden-mount loops stay intact.

- [ ] **Step 1: Add `workpathLabel` prop to `TerminalCard`**

Edit `packages/app/components/TerminalCard.web.tsx`. Add to the props interface:

```ts
interface TerminalCardProps {
  // ...existing fields...
  workpathLabel?: string; // shown in the top-left of the card body when in card mode
}
```

In the destructuring, add `workpathLabel`. In the card's `card`-mode JSX (the non-tab branch), inject a small label element near the top of the card body. Find the existing card body container and add inside (before the existing `<LiveTerminalView>` or similar):

```tsx
{!isTab && workpathLabel && (
  <div
    data-testid="terminal-card-workpath-label"
    style={{
      position: "absolute",
      top: 6,
      left: 8,
      fontSize: 9,
      color: colors.foregroundMuted,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      pointerEvents: "none",
      zIndex: 5,
    }}
  >
    {workpathLabel}
  </div>
)}
```

(Position is `absolute` against the card's outer `position: relative` div. If `colors` isn't imported in TerminalCard, add it.)

- [ ] **Step 2: Pass workpath label from Canvas to each card in the All grid**

In `Canvas.web.tsx`, build a label resolver:

```ts
const workpathLabelByMachineAndCwd = useMemo(() => {
  const map = new Map<string, string>();
  for (const bm of bookmarks) {
    map.set(`${bm.machine_id}::${bm.path}`, bm.label);
  }
  return map;
}, [bookmarks]);

const labelForTerminal = (t: TerminalInfo): string | undefined => {
  return workpathLabelByMachineAndCwd.get(`${t.machine_id}::${t.cwd}`);
};
```

In the grid `.map((terminal) =>` block, pass:

```tsx
workpathLabel={
  selectedWorkpathId === "all"
    ? `${labelForTerminal(terminal) ?? "—"} · ${terminal.title || ""}`
    : undefined
}
```

The label only shows in All mode (workpath-scoped views know which workpath they're in already).

- [ ] **Step 3: Replace the immersive branch with TabStrip + content**

In `Canvas.web.tsx`, the current return has a top-level branch:

```tsx
{zoomedTerminalId && paneLayouts[zoomedTerminalId] ? (
  <>
    <TerminalBreadcrumb ... />
    <div ...>
      <SplitPaneContainer ... />
    </div>
  </>
) : (
  <div ...>
    <OverviewHeader ... />
    {scopedTerminals.length === 0 ? (...) : (...grid...)}
  </div>
)}
```

Replace with the four-state machine the spec calls for. Compute up front:

```ts
const isAll = selectedWorkpathId === "all";
const workpathBookmark = isAll
  ? null
  : bookmarks.find((b) => b.id === selectedWorkpathId) ?? null;
const inWorkpath = !isAll;
const workpathHasTerminals = inWorkpath && scopedTerminals.length > 0;

// Effective tab id when in workpath scope: explicit zoom or fallback to first.
const effectiveZoomId =
  zoomedTerminalId
    ?? (inWorkpath && workpathHasTerminals ? scopedTerminals[0].id : null);
```

Then the new return body (after the `<main>` opening tag — wrap the four cases):

```tsx
{isAll && !zoomedTerminalId && (
  /* All grid — keep the existing OverviewHeader + grid + empty state JSX. */
  ...
)}

{isAll && zoomedTerminalId && paneLayouts[zoomedTerminalId] && (
  /* All scope, immersive — terminal only, no tab strip. */
  <div
    style={{ flex: 1, overflow: "hidden", display: "flex" }}
    onContextMenu={(e) => handleTerminalContextMenu(e, activePaneId || zoomedTerminalId)}
  >
    <SplitPaneContainer
      node={paneLayouts[zoomedTerminalId]}
      terminals={terminals}
      activePaneId={activePaneId}
      isMobile={isMobile}
      isMachineController={isMachineController}
      deviceId={deviceId}
      terminalCardRefs={terminalCardRefs}
      onSelectTab={(id) => { if (id) onZoomTerminal(id); else onUnzoom(); }}
      onDestroy={onDestroy}
      onClosePane={closePaneById}
      onRequestControl={onRequestControl}
      onReleaseControl={onReleaseControl}
      onActivatePane={handleActivatePane}
      onUpdateRatio={handleUpdateRatio}
    />
  </div>
)}

{inWorkpath && !workpathHasTerminals && workpathBookmark && (
  <WorkpathEmptyState
    bookmark={workpathBookmark}
    canCreateTerminal={isActiveController}
    quickCommands={quickCommands}
    onNewTerminal={() => {
      if (onNewTerminal) onNewTerminal();
    }}
    onQuickCommand={(command) => {
      if (!activeMachine) return;
      if (!isMachineController(activeMachine.id)) return;
      void createTerminal(activeMachine.id, workpathBookmark.path, deviceId, command).catch(() => {});
      // Note: this bypasses the layout's TERMINAL_CREATED dispatch — we
      // accept it because the events WS picks up the new terminal. If it
      // proves janky in practice, lift this through TerminalCanvas later.
    }}
  />
)}

{inWorkpath && workpathHasTerminals && effectiveZoomId && paneLayouts[effectiveZoomId] && (
  <>
    <TabStrip
      tabs={scopedTerminals}
      activeTabId={effectiveZoomId}
      canCreateTerminal={isActiveController}
      quickCommands={quickCommands}
      onSelectTab={(id) => onZoomTerminal(id)}
      onCloseTab={(t) => closePaneById(t.id)}
      onNewTerminal={() => { if (onNewTerminal) onNewTerminal(); }}
      onQuickCommand={(command) => {
        if (!activeMachine || !workpathBookmark) return;
        if (!isMachineController(activeMachine.id)) return;
        void createTerminal(activeMachine.id, workpathBookmark.path, deviceId, command).catch(() => {});
      }}
    />
    <div
      style={{ flex: 1, overflow: "hidden", display: "flex" }}
      onContextMenu={(e) => handleTerminalContextMenu(e, activePaneId || effectiveZoomId)}
    >
      <SplitPaneContainer
        node={paneLayouts[effectiveZoomId]}
        terminals={terminals}
        activePaneId={activePaneId}
        isMobile={isMobile}
        isMachineController={isMachineController}
        deviceId={deviceId}
        terminalCardRefs={terminalCardRefs}
        onSelectTab={(id) => { if (id) onZoomTerminal(id); else onUnzoom(); }}
        onDestroy={onDestroy}
        onClosePane={closePaneById}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
        onActivatePane={handleActivatePane}
        onUpdateRatio={handleUpdateRatio}
      />
    </div>
  </>
)}
```

Add the imports at top:

```ts
import { TabStrip, type QuickCommand } from "./TabStrip.web";
import { WorkpathEmptyState } from "./WorkpathEmptyState.web";
```

Add a new `quickCommands: QuickCommand[]` prop to `CanvasProps` and accept it in destructuring. Wire it from `TerminalCanvas` (where the state already lives in PR #137).

Drop the `TerminalBreadcrumb` import and any references.

The pane-layout `useEffect` that creates a leaf when `zoomedTerminalId` changes also needs to fire for `effectiveZoomId`:

```ts
useEffect(() => {
  if (effectiveZoomId && !paneLayouts[effectiveZoomId]) {
    setPaneLayouts((prev) => ({
      ...prev,
      [effectiveZoomId]: createLeaf(effectiveZoomId),
    }));
    setActivePaneId(effectiveZoomId);
  }
}, [effectiveZoomId, paneLayouts]);
```

Replace the existing `useEffect` that referenced `zoomedTerminalId`.

The `useEffect` that focuses the active pane should also use `effectiveZoomId`:

```ts
useEffect(() => {
  if (!effectiveZoomId) return;
  const targetId = activePaneId || effectiveZoomId;
  const rafId = requestAnimationFrame(() => {
    terminalCardRefs.current[targetId]?.focus();
  });
  return () => cancelAnimationFrame(rafId);
}, [effectiveZoomId, activePaneId]);
```

`renderedIds` should mount whichever leaves are visible — preserve the existing logic but switch from `paneLayouts[zoomedTerminalId]` to `paneLayouts[effectiveZoomId]`.

Drop `siblingsForBreadcrumb` (unused now).

- [ ] **Step 4: Pass `quickCommands` from TerminalCanvas to Canvas**

In `packages/app/components/TerminalCanvas.web.tsx`, find the `<Canvas ... />` JSX and add `quickCommands={quickCommands}` to the props.

- [ ] **Step 5: Verify typecheck + vitest**

```bash
pnpm typecheck 2>&1 | tail -10
pnpm test 2>&1 | tail -10
```

Expected: clean. Any leftover ref to `TerminalBreadcrumb` or `siblingsForBreadcrumb` → remove.

- [ ] **Step 6: Commit**

```bash
git add packages/app/components/Canvas.web.tsx \
        packages/app/components/TerminalCard.web.tsx \
        packages/app/components/TerminalCanvas.web.tsx
git commit -m "refactor(canvas): TabStrip + WorkpathEmptyState; All-grid keeps cards with workpath labels"
```

---

### Task 11: Crossfade animation when canvas content changes

**Files:**
- Modify: `packages/app/components/Canvas.web.tsx`

A single CSS transition on the outermost wrapper of canvas content. Skip when `prefers-reduced-motion` is set.

- [ ] **Step 1: Wrap each canvas-state branch in a fade container**

In `Canvas.web.tsx`, inside the `<main>`, wrap the four-state body in a single element keyed by the state, so React mounts/unmounts triggers the transition:

```tsx
<div
  key={
    isAll && !zoomedTerminalId
      ? "all-grid"
      : isAll
        ? `all-zoom-${zoomedTerminalId}`
        : !workpathHasTerminals
          ? `wp-empty-${selectedWorkpathId}`
          : `wp-${selectedWorkpathId}`
  }
  style={{
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    animation: "webmuxCanvasFade 180ms ease-out",
  }}
>
  {/* the four-state body from Task 10 */}
</div>
```

Add the keyframes once, in the same file (just below imports — module-level CSS via a `useEffect` injecting a `<style>` is overkill; use inline `<style>` rendered conditionally):

```tsx
// Insert once at the top of the component's JSX:
<style>{`
  @keyframes webmuxCanvasFade {
    from { opacity: 0.6; }
    to   { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-canvas-fade] { animation: none !important; }
  }
`}</style>
```

Add `data-canvas-fade` to the wrapper for the reduced-motion override to bite.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | tail -3
```

- [ ] **Step 3: Manual smoke** (build the app, switch workpaths, observe a brief fade)

```bash
pnpm --filter @webmux/shared build
pnpm --filter @webmux/app build 2>&1 | tail -5
```

Expected: build succeeds. (No automated visual test for animation; e2e validates structural changes.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/components/Canvas.web.tsx
git commit -m "feat(ui): crossfade between canvas states (180ms; respects reduced-motion)"
```

---

### Task 12: Update e2e helpers + existing specs

**Files:**
- Modify: `e2e/tests/helpers.ts`
- Modify: every `e2e/tests/*.spec.ts` that references rail/overlay testids.

Search-and-replace pass; the goal is for the existing e2e suite to compile and pass against the new UI.

- [ ] **Step 1: Catalog all references**

```bash
cd /home/chareice/projects/webmux/all-hot-corner
grep -rn 'workpath-rail\|workpath-overlay\|rail-pill\|rail-machine\|rail-add-bookmark\|rail-open-settings\|overlay-bookmark\|overlay-quick-cmd\|overlay-add-directory\|overlay-remove\|overlay-select-all\|overlay-request-control\|expandNavColumn\|breadcrumb-back\|breadcrumb-sibling\|breadcrumb-menu\|terminal-breadcrumb\|terminal-fit-button' e2e/tests/ 2>&1 | head -80
```

Use the output as the to-do list for this task.

- [ ] **Step 2: Rewrite `helpers.ts`'s `expandNavColumn` → `openPanel`**

Replace `expandNavColumn` with:

```ts
export async function openPanel(page: Page): Promise<void> {
  // The workpath panel is open by default. If a previous test/state
  // closed it, send Cmd+B to re-open. Then assert it's visible.
  const panel = page.getByTestId("workpath-panel");
  if (!(await panel.isVisible().catch(() => false))) {
    await page.keyboard.press("Meta+B");
  }
  await expect(panel).toBeVisible();
}
```

Search the test files for callers of `expandNavColumn` and rename to `openPanel`. Same import statement.

- [ ] **Step 3: Replace testids across the e2e suite**

Mapping:

| Old (rail/overlay/breadcrumb)              | New                                       |
|--------------------------------------------|-------------------------------------------|
| `workpath-rail`                            | `workpath-panel`                          |
| `workpath-overlay`                         | `workpath-panel`                          |
| `rail-machine-${id}`                       | `activity-bar-machine-${id}`              |
| `rail-pill-all`                            | `panel-select-all`                        |
| `rail-pill-${bookmarkId}`                  | `panel-bookmark-${bookmarkId}`            |
| `rail-add-bookmark`                        | `panel-add-bookmark` (or `activity-bar-add-directory` for multi-machine; tests are single-machine) |
| `rail-open-settings`                       | `panel-open-settings`                     |
| `overlay-select-all`                       | `panel-select-all`                        |
| `overlay-bookmark-${id}`                   | `panel-bookmark-${id}`                    |
| `overlay-remove-${id}`                     | `panel-remove-${id}`                      |
| `overlay-add-directory`                    | `panel-add-directory`                     |
| `overlay-quick-cmd-${bm}-${label}`         | `tab-quick-cmd-${label}` (in tab strip) OR `workpath-empty-quick-cmd-${label}` (in empty state) — choose per test context |
| `overlay-request-control-${machineId}`    | `panel-request-control-${machineId}`      |
| `terminal-breadcrumb`                      | `tab-strip` (or remove the assertion entirely if the test just used it as a presence check post-zoom) |
| `breadcrumb-back`                          | (gone — `Esc` or click `panel-select-all`) |
| `breadcrumb-sibling-${id}`                 | `tab-${id}`                               |
| `breadcrumb-menu`                          | (gone — context menu accessible via right-click) |
| `terminal-fit-button` on desktop           | (gone — auto-fit, unchanged from PR #137) |

For each test file:
- `e2e/tests/core-control-flow.spec.ts`
- `e2e/tests/multi-device-collaboration.spec.ts`
- `e2e/tests/quick-commands.spec.ts`
- `e2e/tests/tab-navigation.spec.ts`
- `e2e/tests/terminal-handoff-sizing.spec.ts`
- `e2e/tests/terminal-multi-attach.spec.ts`
- `e2e/tests/terminal-tab-switch.spec.ts`
- `e2e/tests/terminal-attach-recovery.spec.ts`
- `e2e/tests/mobile-controls.spec.ts`

apply the mapping. Tests that asserted on `breadcrumb-back` followed by `overview-header` should be replaced with: dispatch `Escape` (to clear zoom) or click `panel-select-all`, then assert on `overview-header`.

- [ ] **Step 4: Run the e2e suite**

```bash
docker compose -f e2e/docker-compose.yml down --remove-orphans 2>&1 | tail -3
docker compose -f e2e/docker-compose.yml build hub 2>&1 | tail -3
./e2e/run-in-docker.sh 2>&1 | tail -30
```

Expected: 12/12 pass (or 12/12 + however many specs we add later).

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/
git commit -m "test(e2e): rename rail/overlay/breadcrumb testids to new panel/tab strip"
```

---

### Task 13: New e2e specs — tab strip behavior + panel toggle

**Files:**
- Create: `e2e/tests/tab-strip.spec.ts`
- Create: `e2e/tests/panel-toggle.spec.ts`

- [ ] **Step 1: Create tab-strip spec**

```ts
// e2e/tests/tab-strip.spec.ts
import { test, expect } from "@playwright/test";
import {
  expectTerminalCount,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  openPanel,
  resetMachineState,
} from "./helpers";

test("tab strip: open, switch, close", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  await openPanel(page);
  await page
    .getByTestId("panel-request-control-e2e-node")
    .click()
    .catch(() => {/* already controlled */});

  // Open the ~ workpath; first terminal lands and tab strip shows.
  await page.getByTestId("panel-bookmark-local-home").click();
  await expect(page.getByTestId("tab-strip")).toBeVisible();
  await expectTerminalCount(page, 1);

  const t1 = (await listTerminals(page))[0];
  expect(t1).toBeDefined();

  // Open two more terminals via Cmd+Shift+T → 3 tabs total.
  await page.keyboard.press("Meta+Shift+T");
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  await page.keyboard.press("Meta+Shift+T");
  await expect.poll(async () => (await listTerminals(page)).length).toBe(3);

  const all = await listTerminals(page);
  for (const t of all) {
    await expect(page.getByTestId(`tab-${t.id}`)).toBeVisible();
  }

  // Click the first tab; verify it becomes active.
  await page.getByTestId(`tab-${all[0].id}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Close the active tab; another terminal becomes active.
  await page.getByTestId(`tab-close-${all[0].id}`).click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);

  await context.close();
});
```

- [ ] **Step 2: Create panel-toggle spec**

```ts
// e2e/tests/panel-toggle.spec.ts
import { test, expect } from "@playwright/test";
import { openApp, resetMachineState } from "./helpers";

test("Cmd+B toggles workpath panel and persists across reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  await expect(page.getByTestId("workpath-panel")).toBeVisible();

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("workpath-panel")).toHaveCount(0);

  await page.reload();
  await openApp(page);
  await expect(page.getByTestId("workpath-panel")).toHaveCount(0);

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("workpath-panel")).toBeVisible();

  await context.close();
});
```

- [ ] **Step 3: Run e2e**

```bash
./e2e/run-in-docker.sh 2>&1 | tail -10
```

Expected: 14/14 pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/tab-strip.spec.ts e2e/tests/panel-toggle.spec.ts
git commit -m "test(e2e): tab strip behavior + panel toggle persistence"
```

---

### Task 14: Delete legacy files

**Files:**
- Delete: `packages/app/components/WorkpathRail.web.tsx`
- Delete: `packages/app/components/WorkpathOverlay.web.tsx`
- Delete: `packages/app/components/TerminalBreadcrumb.web.tsx`
- Delete: `packages/app/lib/workpathTag.ts`
- Delete: `packages/app/lib/workpathTag.test.ts`

- [ ] **Step 1: Confirm no consumers remain**

```bash
cd /home/chareice/projects/webmux/all-hot-corner
grep -rn "WorkpathRail\|WorkpathOverlay\|TerminalBreadcrumb\|workpathTag\|computeWorkpathTags\|RailWorkpath" packages/ 2>&1 | grep -v ".test." | head -10
```

Expected: empty (no matches).

- [ ] **Step 2: Delete the files**

```bash
rm packages/app/components/WorkpathRail.web.tsx \
   packages/app/components/WorkpathOverlay.web.tsx \
   packages/app/components/TerminalBreadcrumb.web.tsx \
   packages/app/lib/workpathTag.ts \
   packages/app/lib/workpathTag.test.ts
```

- [ ] **Step 3: Verify typecheck + tests**

```bash
pnpm typecheck 2>&1 | tail -5
pnpm test 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: drop legacy WorkpathRail / WorkpathOverlay / TerminalBreadcrumb"
```

---

### Task 15: Final verification + push + PR

- [ ] **Step 1: Full typecheck + unit + e2e**

```bash
cd /home/chareice/projects/webmux/all-hot-corner
pnpm typecheck 2>&1 | tail -5
pnpm test 2>&1 | tail -10
docker compose -f e2e/docker-compose.yml down --remove-orphans 2>&1 | tail -3
docker compose -f e2e/docker-compose.yml build hub 2>&1 | tail -3
./e2e/run-in-docker.sh 2>&1 | tail -10
```

Expected: typecheck clean, vitest all pass, e2e all pass.

- [ ] **Step 2: Manual smoke (web + Tauri if convenient)**

Spin up the dev server, exercise:
- Single-machine mode: activity bar absent, panel footer has + and ⚙.
- Multi-machine (the e2e env doesn't multi-machine, so verify on a real env if possible OR force in code briefly).
- `Cmd+B` toggles panel; refresh → panel state persists.
- `Cmd+0` snaps to All from any zoomed terminal.
- `Cmd+Tab` only cycles within the current workpath.
- Open 3 terminals in one workpath; tab strip shows 3 tabs; close one; the visible tab updates.
- Empty workpath → empty state; `+` button creates a terminal.
- Quick-cmd chips: configure 4 commands in settings, verify 3 show inline + 1 in `⋯`.
- Mobile (DevTools mobile emulation): hamburger opens drawer with panel.

If anything breaks, fix and re-run typecheck + tests. Commit each fix.

- [ ] **Step 3: Push branch + create PR**

```bash
git push -u origin all-hot-corner
gh pr create --title "feat(ui): nav redesign — activity bar + workpath panel + per-workpath tabs" \
  --body "$(cat <<'EOF'
## Summary

Replaces the rail+overlay nav (PR #133) with a VS Code-style three-column layout and brings tabs back inside each workpath. Removes the hover/hot-corner trigger pattern entirely.

- **Activity bar (48px, multi-machine only)** — machine switcher + global actions; hidden when there's only one machine (footer of WorkpathPanel takes the actions).
- **Workpath panel (~220px, default open, Cmd+B toggles)** — full workpath names + paths + counts. Inline add-directory PathInput. State persists in localStorage.
- **Tab strip per workpath** — live dot + title + close on each tab. Pinned right region: `+` (new blank terminal) + quick-command chips (3 inline, rest in `⋯`).
- **All view** — keeps the grid; each card now shows a small `workpath · title` label.
- **Workpath empty state** — large "+ New terminal here" + Cmd+Shift+T hint + quick-command chips.
- **Mobile** — hamburger drawer renders the same activity bar + panel.
- **Shortcuts**: `Cmd+0` (new) → All, `Cmd+Tab`/`Cmd+Shift+Tab` rescoped to current workpath, others unchanged.
- **Removed**: WorkpathRail, WorkpathOverlay, TerminalBreadcrumb, workpathTag, document-level pointermove tracking, `addDirectoryOpen` plumbing, `columnForceExpanded` (renamed `panelOpen`).

Spec: `docs/superpowers/specs/2026-04-17-nav-redesign-with-tabs-design.md`
Plan: `docs/superpowers/plans/2026-04-17-nav-redesign-with-tabs.md`

## Test plan

- [x] `pnpm typecheck`
- [x] `pnpm test` (unit, includes new `panelOpenStorage` + reducer rename)
- [x] Full e2e in Docker (12 existing + 2 new = 14)
- [ ] Manual smoke on prod after deploy: switch workpaths, open 3+ tabs, close, Cmd+B, Cmd+0, Cmd+Tab cycle, mobile drawer.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

Expected: PR URL printed.

- [ ] **Step 4: Final commit / squash review**

If any fix-ups landed during manual smoke, ensure they're committed before pushing the final state.

---

## Self-review notes (already addressed inline)

- **Spec coverage:** every spec section maps to one or more tasks (architecture → T8/T10; activity bar → T4/T8; workpath panel → T5/T8; canvas states → T10; tab strip → T6; empty state → T7; mobile → T8 (NavColumn already mounts inside the existing mobile drawer); shortcuts → T3/T9; removed components → T14; data flow / panelOpen persistence → T1/T2; animation → T11; tests → T12/T13/T15).
- **Type consistency:** `panelOpen` is the single rename used everywhere; `TOGGLE_PANEL` is the single new action; `effectiveZoomId` is the single derived value used in Canvas; testids follow the table at the top.
- **No placeholders:** every step shows code or commands; no "TBD"/"add error handling".

# Main UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal per-terminal tab strip and the 260 px permanent sidebar with a vertical workpath rail (collapsed 56 px, expanded 240 px overlay), an Overview grid header, and a zoomed-terminal breadcrumb. Implements the spec at `docs/superpowers/specs/2026-04-17-main-ui-redesign-design.md`.

**Architecture:** Pure utilities + reducer drive selection state (`selectedWorkpathId`, `zoomedTerminalId`, `columnForceExpanded`). New `WorkpathRail` / `WorkpathOverlay` components replace `Sidebar`. `Canvas.web.tsx` is refactored to render an Overview header + filtered grid + zoomed breadcrumb instead of the old tab strip. `TitleBar.tsx` is demoted to window-chrome only. Shortcuts extended in the existing `lib/shortcuts.ts`.

**Tech Stack:** React Native for Web (used in web build via `Platform.OS === "web"`), TypeScript, xterm.js (unchanged), Vitest for unit tests, Playwright for e2e.

---

## File Structure

**Created:**
- `packages/app/lib/workpathTag.ts` — deterministic short-tag abbreviation
- `packages/app/lib/workpathTag.test.mjs`
- `packages/app/lib/mainLayoutReducer.ts` — pure reducer for selection state
- `packages/app/lib/mainLayoutReducer.test.mjs`
- `packages/app/components/WorkpathRail.web.tsx` — 56 px collapsed column
- `packages/app/components/WorkpathOverlay.web.tsx` — 240 px expanded overlay
- `packages/app/components/NavColumn.web.tsx` — orchestrates rail + overlay + hover state
- `packages/app/components/OverviewHeader.web.tsx` — info bar above grid
- `packages/app/components/TerminalBreadcrumb.web.tsx` — zoomed-view top row
- `packages/app/components/AppTitleBar.web.tsx` — window-chrome only (replaces tab logic in TitleBar)

**Modified:**
- `packages/app/components/Canvas.web.tsx` — remove TitleBar tab logic; use OverviewHeader + TerminalBreadcrumb; filter grid by workpath
- `packages/app/components/TerminalCanvas.web.tsx` — use `NavColumn` instead of `Sidebar`; wire reducer; extend shortcut actions
- `packages/app/lib/shortcuts.ts` — add `toggleNav`, `selectWorkpathByIndex`, `closeInZoom`
- `e2e/tests/helpers.ts` — update test IDs
- `e2e/tests/tab-navigation.spec.ts` — rewrite around new selectors
- `e2e/tests/quick-commands.spec.ts` — update selectors
- `e2e/tests/core-control-flow.spec.ts` — update selectors
- `e2e/tests/mobile-controls.spec.ts` — (verify no breakage; mobile drawer behavior preserved)

**Deleted at end (after replacements shipped):**
- `packages/app/components/Sidebar.tsx` — unused after NavColumn takes over
- `packages/app/components/TitleBar.tsx` — replaced by AppTitleBar

---

### Task 1: Workpath tag utility

**Files:**
- Create: `packages/app/lib/workpathTag.ts`
- Test: `packages/app/lib/workpathTag.test.mjs`

Pure function that maps a list of bookmark labels to short tags. Deterministic, 2 chars by default, expands to 3 if needed to disambiguate. `"All"` never collides with workpaths (uppercase sentinel).

- [ ] **Step 1.1: Write the failing test**

```javascript
// packages/app/lib/workpathTag.test.mjs
import { describe, it, expect } from "vitest";
import { computeWorkpathTags } from "./workpathTag";

describe("computeWorkpathTags", () => {
  it("returns 2-char lowercase tag for a single label", () => {
    expect(computeWorkpathTags(["webmux"])).toEqual({ webmux: "wm" });
  });

  it("preserves 2-char labels verbatim", () => {
    expect(computeWorkpathTags(["z1"])).toEqual({ z1: "z1" });
  });

  it("collapses hyphens/dots when picking letters", () => {
    expect(computeWorkpathTags(["tag-tracing"])).toEqual({ "tag-tracing": "tt" });
    expect(computeWorkpathTags(["app.zalify.com"])).toEqual({ "app.zalify.com": "az" });
  });

  it("disambiguates colliding prefixes by extending to 3 chars", () => {
    const result = computeWorkpathTags(["webmux", "weblog"]);
    expect(result.webmux).not.toEqual(result.weblog);
    expect(result.webmux).toMatch(/^w[a-z0-9]{1,2}$/);
    expect(result.weblog).toMatch(/^w[a-z0-9]{1,2}$/);
  });

  it("falls back to index-suffixed tag when still colliding", () => {
    const result = computeWorkpathTags(["ab", "ab", "ab"]);
    const tags = Object.values(result);
    expect(new Set(tags).size).toBe(3);
  });

  it("is deterministic across calls", () => {
    const labels = ["webmux", "z1", "tag-tracing", "app.zalify.com"];
    expect(computeWorkpathTags(labels)).toEqual(computeWorkpathTags(labels));
  });

  it("handles single-char labels by padding with next char of nothing", () => {
    const result = computeWorkpathTags(["a"]);
    expect(result.a).toBe("a");
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```
cd packages/app && pnpm exec vitest run lib/workpathTag.test.mjs
```

Expected: FAIL with cannot find module `./workpathTag`.

- [ ] **Step 1.3: Implement**

```typescript
// packages/app/lib/workpathTag.ts

/**
 * Compute short display tags for a list of workpath labels.
 * Tags are:
 *   - 2 chars by default (drops non-letters-or-digits when picking)
 *   - Extended to 3 chars to break collisions
 *   - Suffixed with index when still colliding
 *
 * Deterministic: same input always produces same output.
 */
export function computeWorkpathTags(labels: string[]): Record<string, string> {
  const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const pick = (s: string, n: number) => {
    const cleaned = alnum(s);
    return cleaned.slice(0, n);
  };

  const result: Record<string, string> = {};
  const used = new Set<string>();

  // Pass 1: 2-char tag
  for (const label of labels) {
    const tag = pick(label, 2);
    if (!tag) {
      continue;
    }
    if (!used.has(tag)) {
      result[label] = tag;
      used.add(tag);
    }
  }

  // Pass 2: anything still missing, try 3-char
  for (const label of labels) {
    if (result[label]) continue;
    const tag = pick(label, 3);
    if (!tag) {
      continue;
    }
    if (!used.has(tag)) {
      result[label] = tag;
      used.add(tag);
    }
  }

  // Pass 3: still missing — index suffix
  let idx = 0;
  for (const label of labels) {
    if (result[label]) continue;
    let candidate = "";
    do {
      const base = pick(label, 1) || "w";
      candidate = `${base}${idx}`;
      idx++;
    } while (used.has(candidate));
    result[label] = candidate;
    used.add(candidate);
  }

  return result;
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```
cd packages/app && pnpm exec vitest run lib/workpathTag.test.mjs
```

Expected: all 7 tests pass.

- [ ] **Step 1.5: Commit**

```
git add packages/app/lib/workpathTag.ts packages/app/lib/workpathTag.test.mjs
git commit -m "feat(ui): workpath tag abbreviation utility"
```

---

### Task 2: Main layout reducer

**Files:**
- Create: `packages/app/lib/mainLayoutReducer.ts`
- Test: `packages/app/lib/mainLayoutReducer.test.mjs`

Pure reducer for the new selection state machine. Handles all transitions listed in spec §7.

- [ ] **Step 2.1: Write the failing test**

```javascript
// packages/app/lib/mainLayoutReducer.test.mjs
import { describe, it, expect } from "vitest";
import {
  createInitialMainLayout,
  mainLayoutReducer,
} from "./mainLayoutReducer";

describe("mainLayoutReducer", () => {
  const initial = createInitialMainLayout();

  it("starts with All selected and no zoomed terminal", () => {
    expect(initial.selectedWorkpathId).toBe("all");
    expect(initial.zoomedTerminalId).toBeNull();
    expect(initial.columnForceExpanded).toBe(false);
  });

  it("SELECT_WORKPATH sets workpath and clears zoom", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "SELECT_WORKPATH", workpathId: "wp-webmux" },
    );
    expect(next.selectedWorkpathId).toBe("wp-webmux");
    expect(next.zoomedTerminalId).toBeNull();
  });

  it("ZOOM_TERMINAL sets zoomed terminal without touching workpath", () => {
    const next = mainLayoutReducer(
      { ...initial, selectedWorkpathId: "wp-webmux" },
      { type: "ZOOM_TERMINAL", terminalId: "t1" },
    );
    expect(next.selectedWorkpathId).toBe("wp-webmux");
    expect(next.zoomedTerminalId).toBe("t1");
  });

  it("UNZOOM clears zoomed terminal", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "UNZOOM" },
    );
    expect(next.zoomedTerminalId).toBeNull();
  });

  it("TERMINAL_CREATED selects workpath and zooms to new terminal", () => {
    const next = mainLayoutReducer(initial, {
      type: "TERMINAL_CREATED",
      terminalId: "t-new",
      workpathId: "wp-z1",
    });
    expect(next.selectedWorkpathId).toBe("wp-z1");
    expect(next.zoomedTerminalId).toBe("t-new");
  });

  it("TERMINAL_DESTROYED clears zoom if it was the zoomed one", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "TERMINAL_DESTROYED", terminalId: "t1" },
    );
    expect(next.zoomedTerminalId).toBeNull();
  });

  it("TERMINAL_DESTROYED leaves zoom alone if a different terminal was closed", () => {
    const next = mainLayoutReducer(
      { ...initial, zoomedTerminalId: "t1" },
      { type: "TERMINAL_DESTROYED", terminalId: "t2" },
    );
    expect(next.zoomedTerminalId).toBe("t1");
  });

  it("WORKPATH_DELETED falls back to All if the deleted one was selected", () => {
    const next = mainLayoutReducer(
      { ...initial, selectedWorkpathId: "wp-webmux" },
      { type: "WORKPATH_DELETED", workpathId: "wp-webmux" },
    );
    expect(next.selectedWorkpathId).toBe("all");
  });

  it("WORKPATH_DELETED leaves selection alone if a different workpath was deleted", () => {
    const next = mainLayoutReducer(
      { ...initial, selectedWorkpathId: "wp-webmux" },
      { type: "WORKPATH_DELETED", workpathId: "wp-z1" },
    );
    expect(next.selectedWorkpathId).toBe("wp-webmux");
  });

  it("TOGGLE_NAV_FORCE_EXPANDED flips the flag", () => {
    const once = mainLayoutReducer(initial, { type: "TOGGLE_NAV_FORCE_EXPANDED" });
    expect(once.columnForceExpanded).toBe(true);
    const twice = mainLayoutReducer(once, { type: "TOGGLE_NAV_FORCE_EXPANDED" });
    expect(twice.columnForceExpanded).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run to verify failure**

```
cd packages/app && pnpm exec vitest run lib/mainLayoutReducer.test.mjs
```

Expected: FAIL (cannot find module).

- [ ] **Step 2.3: Implement**

```typescript
// packages/app/lib/mainLayoutReducer.ts

export type WorkpathSelection = "all" | string;

export interface MainLayoutState {
  selectedWorkpathId: WorkpathSelection;
  zoomedTerminalId: string | null;
  columnForceExpanded: boolean;
}

export type MainLayoutAction =
  | { type: "SELECT_WORKPATH"; workpathId: WorkpathSelection }
  | { type: "ZOOM_TERMINAL"; terminalId: string }
  | { type: "UNZOOM" }
  | { type: "TERMINAL_CREATED"; terminalId: string; workpathId: WorkpathSelection }
  | { type: "TERMINAL_DESTROYED"; terminalId: string }
  | { type: "WORKPATH_DELETED"; workpathId: string }
  | { type: "TOGGLE_NAV_FORCE_EXPANDED" };

export function createInitialMainLayout(): MainLayoutState {
  return {
    selectedWorkpathId: "all",
    zoomedTerminalId: null,
    columnForceExpanded: false,
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
    case "TOGGLE_NAV_FORCE_EXPANDED":
      return { ...state, columnForceExpanded: !state.columnForceExpanded };
  }
}
```

- [ ] **Step 2.4: Run to verify pass**

```
cd packages/app && pnpm exec vitest run lib/mainLayoutReducer.test.mjs
```

Expected: all 10 tests pass.

- [ ] **Step 2.5: Commit**

```
git add packages/app/lib/mainLayoutReducer.ts packages/app/lib/mainLayoutReducer.test.mjs
git commit -m "feat(ui): main layout reducer (selection + zoom state)"
```

---

### Task 3: WorkpathRail (collapsed 56 px column)

**Files:**
- Create: `packages/app/components/WorkpathRail.web.tsx`

Renders the collapsed 56 px rail: machine badge at top, `All` pill, workpath pills with tag + live dot + count, `+` and `⚙` at the bottom.

- [ ] **Step 3.1: Implement the rail**

```tsx
// packages/app/components/WorkpathRail.web.tsx
import { memo } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { colors } from "@/lib/colors";

export interface RailWorkpath {
  bookmark: Bookmark;
  tag: string;
  terminalCount: number;
  hasLive: boolean;
}

interface WorkpathRailProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  selectedWorkpathId: string | "all";
  workpaths: RailWorkpath[];
  totalTerminalCount: number;
  onSelectMachine: (id: string) => void;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onAddBookmark: () => void;
  onOpenSettings: () => void;
  onExpandHoverEnter: () => void;
  onExpandHoverLeave: () => void;
}

function WorkpathRailComponent(props: WorkpathRailProps) {
  const {
    machines,
    activeMachineId,
    selectedWorkpathId,
    workpaths,
    totalTerminalCount,
    onSelectMachine,
    onSelectAll,
    onSelectWorkpath,
    onAddBookmark,
    onOpenSettings,
    onExpandHoverEnter,
    onExpandHoverLeave,
  } = props;

  const machineBadgeText = (m: MachineInfo) =>
    m.name.length <= 5 ? m.name : m.name.slice(0, 2).toLowerCase();

  return (
    <div
      data-testid="workpath-rail"
      onPointerEnter={onExpandHoverEnter}
      onPointerLeave={onExpandHoverLeave}
      style={{
        width: 56,
        minWidth: 56,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        paddingTop: 8,
        paddingBottom: 8,
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Machine badges */}
      {machines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingInline: 8 }}>
          {machines.map((m) => {
            const selected = m.id === activeMachineId;
            return (
              <button
                key={m.id}
                data-testid={`rail-machine-${m.id}`}
                onClick={() => onSelectMachine(m.id)}
                title={m.name}
                style={{
                  background: selected ? colors.accent : colors.backgroundSecondary,
                  color: selected ? colors.background : colors.accent,
                  border: "none",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 0",
                  cursor: "pointer",
                }}
              >
                {machineBadgeText(m)}
              </button>
            );
          })}
          <div style={{ height: 1, background: colors.border, marginBlock: 6 }} />
        </div>
      )}

      {/* All pill */}
      <button
        data-testid="rail-pill-all"
        onClick={onSelectAll}
        style={{
          ...pillBase,
          background: selectedWorkpathId === "all" ? pillSelectedBg : "transparent",
          borderLeft: selectedWorkpathId === "all"
            ? `2px solid ${colors.accent}`
            : "2px solid transparent",
          color: selectedWorkpathId === "all" ? colors.accent : colors.foreground,
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 0.5 }}>All</div>
        {totalTerminalCount > 0 && (
          <div style={{ fontSize: 9, color: colors.foregroundMuted }}>
            {totalTerminalCount}
          </div>
        )}
      </button>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {workpaths.map((wp) => {
          const selected = selectedWorkpathId === wp.bookmark.id;
          return (
            <button
              key={wp.bookmark.id}
              data-testid={`rail-pill-${wp.bookmark.id}`}
              onClick={() => onSelectWorkpath(wp.bookmark.id)}
              title={wp.bookmark.label}
              style={{
                ...pillBase,
                background: selected ? pillSelectedBg : "transparent",
                borderLeft: selected
                  ? `2px solid ${colors.accent}`
                  : "2px solid transparent",
                color: selected ? colors.accent : colors.foreground,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: selected ? 700 : 500 }}>
                {wp.tag}
              </div>
              {wp.terminalCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 3,
                    justifyContent: "center",
                    alignItems: "center",
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: wp.hasLive
                        ? colors.accent
                        : colors.foregroundMuted,
                    }}
                  />
                  <span style={{ fontSize: 9, color: colors.foregroundMuted }}>
                    {wp.terminalCount}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, paddingTop: 6 }}>
        <button
          data-testid="rail-add-bookmark"
          onClick={onAddBookmark}
          title="Add directory"
          style={iconBtn}
        >
          +
        </button>
        <button
          data-testid="rail-open-settings"
          onClick={onOpenSettings}
          title="Settings"
          style={iconBtn}
        >
          &#9881;
        </button>
      </div>
    </div>
  );
}

const pillBase: React.CSSProperties = {
  paddingBlock: 8,
  paddingInline: 6,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "center",
  width: "100%",
};

const pillSelectedBg = "rgba(217, 119, 87, 0.08)"; // translucent terracotta

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#87867f",
  fontSize: 14,
  cursor: "pointer",
  padding: 4,
  lineHeight: 1,
};

export const WorkpathRail = memo(WorkpathRailComponent);
```

- [ ] **Step 3.2: Typecheck**

```
cd packages/app && pnpm exec tsc --noEmit
```

Expected: no errors (the file is not imported anywhere yet, but should compile standalone).

- [ ] **Step 3.3: Commit**

```
git add packages/app/components/WorkpathRail.web.tsx
git commit -m "feat(ui): WorkpathRail collapsed column"
```

---

### Task 4: WorkpathOverlay (expanded 240 px)

**Files:**
- Create: `packages/app/components/WorkpathOverlay.web.tsx`

Renders the 240 px overlay: machine header, `All` row, bookmarks with label + path + quick-command chips, `+ Add directory`. Reuses `PathInput` and `AddMachinePanel` patterns from current `Sidebar.tsx` but inline for this panel.

- [ ] **Step 4.1: Extract PathInput to a shared file**

First, move the existing `PathInput` component out of `Sidebar.tsx` into its own file so both old and new can use it during the transition.

Create `packages/app/components/PathInput.web.tsx` with the contents of the current `PathInput` function from `Sidebar.tsx` (lines ~65–304), exporting it. Update `Sidebar.tsx` to import it (`import { PathInput } from "./PathInput.web";`) and delete the local copy.

- [ ] **Step 4.2: Typecheck / existing tests pass**

```
cd packages/app && pnpm exec tsc --noEmit
pnpm exec vitest run
```

Expected: no new errors; unit tests still green.

- [ ] **Step 4.3: Commit refactor**

```
git add packages/app/components/PathInput.web.tsx packages/app/components/Sidebar.tsx
git commit -m "refactor(ui): extract PathInput from Sidebar for reuse"
```

- [ ] **Step 4.4: Implement the overlay**

```tsx
// packages/app/components/WorkpathOverlay.web.tsx
import { memo, useEffect, useRef, useState } from "react";
import type { Bookmark, MachineInfo } from "@webmux/shared";
import {
  listBookmarks,
  createBookmark,
  deleteBookmark,
  getSettings,
} from "@/lib/api";
import { colors } from "@/lib/colors";
import { PathInput } from "./PathInput.web";

interface QuickCommand {
  label: string;
  command: string;
}

interface WorkpathOverlayProps {
  machine: MachineInfo;
  selectedWorkpathId: string | "all";
  terminalCountsByBookmarkId: Record<string, number>;
  liveByBookmarkId: Record<string, boolean>;
  canCreateTerminal: boolean;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onBookmarkDeleted?: (bookmarkId: string) => void;
  onPointerLeave: () => void;
}

function WorkpathOverlayComponent(props: WorkpathOverlayProps) {
  const {
    machine,
    selectedWorkpathId,
    terminalCountsByBookmarkId,
    liveByBookmarkId,
    canCreateTerminal,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onBookmarkDeleted,
    onPointerLeave,
  } = props;

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    listBookmarks(machine.id)
      .then((bms) => {
        if (bms.length === 0) {
          const homeDir = machine.home_dir || "/home";
          setBookmarks([{
            id: "local-home",
            machineId: machine.id,
            path: homeDir,
            label: "~",
            sortOrder: 0,
          }]);
        } else {
          setBookmarks(bms);
        }
      })
      .catch(() => {
        const homeDir = machine.home_dir || "/home";
        setBookmarks([{
          id: "local-home",
          machineId: machine.id,
          path: homeDir,
          label: "~",
          sortOrder: 0,
        }]);
      });
  }, [machine.id, machine.home_dir]);

  useEffect(() => {
    getSettings()
      .then((res) => {
        try {
          setQuickCommands(JSON.parse(res.settings.quick_commands || "[]"));
        } catch {
          /* ignore */
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  const handleAdd = async (path: string) => {
    if (!path) return;
    if (bookmarks.some((b) => b.path === path)) {
      setShowAdd(false);
      return;
    }
    try {
      const bm = await createBookmark(machine.id, path, pathLabel(path));
      setBookmarks((prev) => [...prev, bm]);
    } catch {
      setBookmarks((prev) => [...prev, {
        id: `local-${Date.now()}`,
        machineId: machine.id,
        path,
        label: pathLabel(path),
        sortOrder: prev.length,
      }]);
    }
    setShowAdd(false);
  };

  const handleRemove = async (bm: Bookmark) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== bm.id));
    try {
      await deleteBookmark(bm.id);
    } catch { /* ignore */ }
    onBookmarkDeleted?.(bm.id);
  };

  return (
    <div
      data-testid="workpath-overlay"
      onPointerLeave={onPointerLeave}
      style={{
        position: "absolute",
        left: 56,
        top: 0,
        bottom: 0,
        width: 240,
        background: colors.backgroundSecondary,
        borderRight: `1px solid ${colors.border}`,
        boxShadow: "6px 0 20px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        zIndex: 40,
      }}
    >
      <div
        style={{
          padding: 12,
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              color: colors.foregroundMuted,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Machine
          </div>
          <div style={{ fontSize: 12, color: colors.foreground }}>
            {machine.name} · {machine.os}
          </div>
        </div>
      </div>

      {!canCreateTerminal && onRequestControl && (
        <div style={{ padding: 10 }}>
          <button
            data-testid={`overlay-request-control-${machine.id}`}
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
        {/* All row */}
        <button
          data-testid="overlay-select-all"
          onClick={onSelectAll}
          style={rowStyle(selectedWorkpathId === "all")}
        >
          <span style={{ color: colors.foreground, fontSize: 12 }}>All</span>
        </button>

        <div style={{ height: 1, background: colors.border, margin: "4px 12px" }} />

        {bookmarks.map((bm) => {
          const selected = selectedWorkpathId === bm.id;
          const count = terminalCountsByBookmarkId[bm.id] ?? 0;
          const live = liveByBookmarkId[bm.id] ?? false;
          const visibleCmds = quickCommands.filter((c) => c.label && c.command);
          return (
            <div key={bm.id} style={{ ...rowStyle(selected), paddingBottom: 8 }}>
              <button
                data-testid={`overlay-bookmark-${bm.id}`}
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
                  justifyContent: "space-between",
                  width: "100%",
                  alignItems: "center",
                }}
              >
                <span style={{ color: selected ? colors.accent : colors.foreground, fontSize: 12, fontWeight: selected ? 600 : 400 }}>
                  {bm.label}
                </span>
                <span style={{ color: colors.foregroundMuted, fontSize: 10 }}>
                  {count > 0 ? `${count} ${live ? "●" : ""}` : ""}
                </span>
              </button>
              <div style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 1 }}>
                {bm.path}
              </div>
              {canCreateTerminal && visibleCmds.length > 0 && (
                <div style={{ display: "flex", gap: 3, marginTop: 4, flexWrap: "wrap" }}>
                  {visibleCmds.map((cmd) => (
                    <button
                      key={cmd.label}
                      data-testid={`overlay-quick-cmd-${bm.id}-${cmd.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateTerminal(machine.id, bm.path, cmd.command);
                      }}
                      style={{
                        background: "rgba(217, 119, 87, 0.12)",
                        color: colors.accent,
                        border: "none",
                        borderRadius: 3,
                        fontSize: 9,
                        padding: "1px 5px",
                        cursor: "pointer",
                      }}
                    >
                      {cmd.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                data-testid={`overlay-remove-${bm.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(bm);
                }}
                style={{
                  position: "absolute",
                  right: 8,
                  top: 4,
                  background: "none",
                  border: "none",
                  color: colors.foregroundMuted,
                  cursor: "pointer",
                  fontSize: 10,
                }}
                aria-label="Remove bookmark"
              >
                &#x2715;
              </button>
            </div>
          );
        })}

        {showAdd ? (
          <PathInput
            machineId={machine.id}
            onSubmit={handleAdd}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button
            data-testid="overlay-add-directory"
            onClick={() => setShowAdd(true)}
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
    </div>
  );
}

function rowStyle(selected: boolean): React.CSSProperties {
  return {
    position: "relative",
    padding: "8px 12px",
    background: selected ? "rgba(217, 119, 87, 0.08)" : "transparent",
    borderLeft: selected ? `2px solid ${colors.accent}` : "2px solid transparent",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    textAlign: "left",
  };
}

function pathLabel(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export const WorkpathOverlay = memo(WorkpathOverlayComponent);
```

- [ ] **Step 4.5: Typecheck**

```
cd packages/app && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.6: Commit**

```
git add packages/app/components/WorkpathOverlay.web.tsx
git commit -m "feat(ui): WorkpathOverlay expanded panel"
```

---

### Task 5: NavColumn (composes rail + overlay + hover timing)

**Files:**
- Create: `packages/app/components/NavColumn.web.tsx`

Composes `WorkpathRail` and `WorkpathOverlay`, manages the hover-expanded state (with 200 ms collapse grace), and exposes a `forceExpanded` prop for the `Cmd+B` case.

- [ ] **Step 5.1: Implement**

```tsx
// packages/app/components/NavColumn.web.tsx
import { memo, useRef, useState, useMemo } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { WorkpathRail, type RailWorkpath } from "./WorkpathRail.web";
import { WorkpathOverlay } from "./WorkpathOverlay.web";
import { computeWorkpathTags } from "@/lib/workpathTag";

interface NavColumnProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  bookmarks: Bookmark[];
  terminals: TerminalInfo[];
  selectedWorkpathId: string | "all";
  forceExpanded: boolean;
  canCreateTerminalForActiveMachine: boolean;
  onSelectMachine: (id: string) => void;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onAddBookmark: () => void;
  onOpenSettings: () => void;
  onBookmarkDeleted?: (bookmarkId: string) => void;
}

function matchBookmark(bm: Bookmark, terminal: TerminalInfo): boolean {
  return terminal.machine_id === bm.machineId && terminal.cwd === bm.path;
}

function NavColumnComponent(props: NavColumnProps) {
  const {
    machines,
    activeMachineId,
    bookmarks,
    terminals,
    selectedWorkpathId,
    forceExpanded,
    canCreateTerminalForActiveMachine,
    onSelectMachine,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onAddBookmark,
    onOpenSettings,
    onBookmarkDeleted,
  } = props;

  const [hoverExpanded, setHoverExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeMachine = useMemo(
    () => machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null,
    [machines, activeMachineId],
  );

  const activeMachineBookmarks = useMemo(
    () => bookmarks.filter((b) => b.machineId === activeMachine?.id),
    [bookmarks, activeMachine],
  );

  const counts: Record<string, number> = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const bm of activeMachineBookmarks) {
      acc[bm.id] = terminals.filter((t) => matchBookmark(bm, t)).length;
    }
    return acc;
  }, [activeMachineBookmarks, terminals]);

  // "Live" means any terminal in the bookmark is currently active.
  // Without a richer signal, we treat every open terminal as live.
  const live: Record<string, boolean> = useMemo(() => {
    const acc: Record<string, boolean> = {};
    for (const bm of activeMachineBookmarks) {
      acc[bm.id] = counts[bm.id] > 0;
    }
    return acc;
  }, [activeMachineBookmarks, counts]);

  const tags = useMemo(
    () => computeWorkpathTags(activeMachineBookmarks.map((b) => b.label)),
    [activeMachineBookmarks],
  );

  const rail: RailWorkpath[] = useMemo(
    () => activeMachineBookmarks.map((bm) => ({
      bookmark: bm,
      tag: tags[bm.label] ?? bm.label.slice(0, 2).toLowerCase(),
      terminalCount: counts[bm.id] ?? 0,
      hasLive: live[bm.id] ?? false,
    })),
    [activeMachineBookmarks, tags, counts, live],
  );

  const scheduleCollapse = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setHoverExpanded(false), 200);
  };
  const cancelCollapse = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  const expanded = hoverExpanded || forceExpanded;

  return (
    <div
      data-testid="nav-column"
      style={{ display: "flex", position: "relative", height: "100%" }}
    >
      <WorkpathRail
        machines={machines}
        activeMachineId={activeMachineId}
        selectedWorkpathId={selectedWorkpathId}
        workpaths={rail}
        totalTerminalCount={terminals.length}
        onSelectMachine={onSelectMachine}
        onSelectAll={onSelectAll}
        onSelectWorkpath={onSelectWorkpath}
        onAddBookmark={onAddBookmark}
        onOpenSettings={onOpenSettings}
        onExpandHoverEnter={() => {
          cancelCollapse();
          setHoverExpanded(true);
        }}
        onExpandHoverLeave={scheduleCollapse}
      />
      {expanded && activeMachine && (
        <WorkpathOverlay
          machine={activeMachine}
          selectedWorkpathId={selectedWorkpathId}
          terminalCountsByBookmarkId={counts}
          liveByBookmarkId={live}
          canCreateTerminal={canCreateTerminalForActiveMachine}
          onSelectAll={onSelectAll}
          onSelectWorkpath={onSelectWorkpath}
          onCreateTerminal={onCreateTerminal}
          onRequestControl={onRequestControl}
          onBookmarkDeleted={onBookmarkDeleted}
          onPointerLeave={() => {
            if (!forceExpanded) scheduleCollapse();
          }}
        />
      )}
    </div>
  );
}

export const NavColumn = memo(NavColumnComponent);
```

- [ ] **Step 5.2: Typecheck**

```
cd packages/app && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```
git add packages/app/components/NavColumn.web.tsx
git commit -m "feat(ui): NavColumn composes rail + overlay with hover timing"
```

---

### Task 6: OverviewHeader (info bar)

**Files:**
- Create: `packages/app/components/OverviewHeader.web.tsx`

Header displayed at the top of the content area in Overview mode — shows machine name, control-mode badge, CPU/MEM/terminal count, `Stop Control` toggle, and `+ New terminal`.

- [ ] **Step 6.1: Implement**

```tsx
// packages/app/components/OverviewHeader.web.tsx
import { memo } from "react";
import type { MachineInfo, ResourceStats } from "@webmux/shared";
import { Plus } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

interface OverviewHeaderProps {
  machine: MachineInfo | null;
  stats?: ResourceStats;
  terminalCount: number;
  isController: boolean;
  canCreateTerminal: boolean;
  scopeLabel: string; // "All" or workpath label
  onRequestControl?: () => void;
  onReleaseControl?: () => void;
  onNewTerminal?: () => void;
  isMobile: boolean;
}

function OverviewHeaderComponent({
  machine,
  stats,
  terminalCount,
  isController,
  canCreateTerminal,
  scopeLabel,
  onRequestControl,
  onReleaseControl,
  onNewTerminal,
  isMobile,
}: OverviewHeaderProps) {
  const controlCopy = getTerminalControlCopy(isController);

  if (!machine) return null;

  return (
    <section
      data-testid="overview-header"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 16,
        padding: isMobile ? "14px 16px" : "16px 18px",
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: `linear-gradient(135deg, ${colorAlpha.surfaceOpaque94} 0%, ${colorAlpha.backgroundOpaque98} 100%)`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: colors.foregroundMuted,
            marginBottom: 6,
          }}
        >
          {scopeLabel}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: colors.foreground }}>
            {machine.name}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              background: isController ? colorAlpha.accentLight12 : colorAlpha.warningLight12,
              border: isController ? `1px solid ${colorAlpha.accentBorder}` : `1px solid ${colorAlpha.warningBorder22}`,
              color: isController ? colors.accent : colors.warning,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isController ? colors.accent : colors.warning,
              }}
            />
            {controlCopy.modeLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          justifyContent: isMobile ? "flex-start" : "flex-end",
        }}
      >
        {stats && (
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              color: colors.foregroundSecondary,
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>CPU {Math.round(stats.cpu_percent)}%</span>
            <span>
              MEM {Math.round((stats.memory_used / Math.max(stats.memory_total, 1)) * 100)}%
            </span>
            <span>{terminalCount} terminals</span>
          </div>
        )}

        {canCreateTerminal && onNewTerminal && (
          <button
            data-testid="overview-new-terminal"
            onClick={onNewTerminal}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 999,
              color: colors.foreground,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              padding: "8px 12px",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Plus size={12} />
            New terminal
          </button>
        )}

        {onRequestControl && onReleaseControl && (
          <button
            data-testid="canvas-mode-toggle"
            onClick={() => {
              if (isController) onReleaseControl();
              else onRequestControl();
            }}
            style={{
              background: isController ? "transparent" : colors.accent,
              border: isController ? `1px solid ${colors.border}` : "none",
              borderRadius: 999,
              color: isController ? colors.foreground : colors.background,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              padding: "10px 16px",
            }}
          >
            {controlCopy.toggleLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export const OverviewHeader = memo(OverviewHeaderComponent);
```

- [ ] **Step 6.2: Typecheck + commit**

```
cd packages/app && pnpm exec tsc --noEmit
git add packages/app/components/OverviewHeader.web.tsx
git commit -m "feat(ui): OverviewHeader info bar for grid view"
```

---

### Task 7: TerminalBreadcrumb (zoomed view top)

**Files:**
- Create: `packages/app/components/TerminalBreadcrumb.web.tsx`

Top row inside the zoomed view: back-to-overview, sibling chips, `⋯`.

- [ ] **Step 7.1: Implement**

```tsx
// packages/app/components/TerminalBreadcrumb.web.tsx
import { memo } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { colors } from "@/lib/colors";

interface TerminalBreadcrumbProps {
  scopeLabel: string;
  zoomedTerminalId: string;
  siblings: TerminalInfo[];
  onBack: () => void;
  onSwitchSibling: (terminalId: string) => void;
  onOpenMenu?: (e: React.MouseEvent) => void;
}

function TerminalBreadcrumbComponent({
  scopeLabel,
  zoomedTerminalId,
  siblings,
  onBack,
  onSwitchSibling,
  onOpenMenu,
}: TerminalBreadcrumbProps) {
  return (
    <div
      data-testid="terminal-breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}
    >
      <button
        data-testid="breadcrumb-back"
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: colors.foregroundSecondary,
          cursor: "pointer",
          fontSize: 12,
          padding: "4px 8px",
        }}
        title="Back to Overview (Esc)"
      >
        <ChevronLeft size={14} />
        {scopeLabel} / Overview
      </button>

      <div style={{ flex: 1, display: "flex", gap: 4, overflowX: "auto" }}>
        {siblings
          .filter((t) => t.id !== zoomedTerminalId)
          .map((t) => (
            <button
              key={t.id}
              data-testid={`breadcrumb-sibling-${t.id}`}
              onClick={() => onSwitchSibling(t.id)}
              title={t.title || t.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: 999,
                color: colors.foregroundSecondary,
                cursor: "pointer",
                fontSize: 11,
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: colors.accent,
                }}
              />
              {t.id.slice(0, 8)}
            </button>
          ))}
      </div>

      {onOpenMenu && (
        <button
          data-testid="breadcrumb-menu"
          onClick={onOpenMenu}
          style={{
            background: "none",
            border: "none",
            color: colors.foregroundMuted,
            cursor: "pointer",
            padding: 4,
          }}
          title="Terminal actions"
        >
          <MoreHorizontal size={14} />
        </button>
      )}
    </div>
  );
}

export const TerminalBreadcrumb = memo(TerminalBreadcrumbComponent);
```

- [ ] **Step 7.2: Typecheck + commit**

```
cd packages/app && pnpm exec tsc --noEmit
git add packages/app/components/TerminalBreadcrumb.web.tsx
git commit -m "feat(ui): TerminalBreadcrumb for zoomed view"
```

---

### Task 8: AppTitleBar (window chrome only)

**Files:**
- Create: `packages/app/components/AppTitleBar.web.tsx`

Slimmed-down title bar with just window-controls and the tauri drag region. No tabs.

- [ ] **Step 8.1: Implement**

```tsx
// packages/app/components/AppTitleBar.web.tsx
import { memo } from "react";
import { colors } from "@/lib/colors";
import { isTauri, detectOS } from "@/lib/platform";
import { WindowControls } from "./WindowControls";

function AppTitleBarComponent({ isMobile }: { isMobile: boolean }) {
  if (!isTauri()) return null;
  const isMac = detectOS() === "macos";

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        flexShrink: 0,
        minHeight: isMobile ? 40 : 36,
        userSelect: "none",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      {isMac && <WindowControls position="left" />}
      <div data-tauri-drag-region style={{ flex: 1 }} />
      <WindowControls position="right" />
    </div>
  );
}

export const AppTitleBar = memo(AppTitleBarComponent);
```

- [ ] **Step 8.2: Typecheck + commit**

```
cd packages/app && pnpm exec tsc --noEmit
git add packages/app/components/AppTitleBar.web.tsx
git commit -m "feat(ui): AppTitleBar (window chrome only)"
```

---

### Task 9: Extend shortcuts

**Files:**
- Modify: `packages/app/lib/shortcuts.ts`

Adds `toggleNav` (`Cmd/Ctrl+B`), extends `selectTab` semantics to index into workpaths (index 0 = All), and keeps `closeTab` mapped to the zoom-aware handler in the caller.

- [ ] **Step 9.1: Update shortcuts.ts**

```typescript
// packages/app/lib/shortcuts.ts
import { useEffect } from "react";

interface ShortcutActions {
  newTerminal?: () => void;
  closeTab?: () => void;
  closePane?: () => void;
  nextTab?: () => void;
  prevTab?: () => void;
  selectTab?: (index: number) => void;
  splitVertical?: () => void;
  splitHorizontal?: () => void;
  focusPrevPane?: () => void;
  focusNextPane?: () => void;
  toggleNav?: () => void;
}

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
  if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") return true;
  if (event.key === "Tab") return true;
  if (!event.shiftKey && event.code === "KeyB") return true;

  return false;
}

export function useShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (event.shiftKey && event.code === "KeyT") {
        event.preventDefault();
        actions.newTerminal?.();
        return;
      }

      if (!event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        actions.closeTab?.();
        return;
      }

      if (event.shiftKey && event.code === "KeyW") {
        event.preventDefault();
        actions.closePane?.();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) actions.prevTab?.();
        else actions.nextTab?.();
        return;
      }

      if (!event.shiftKey && event.code >= "Digit1" && event.code <= "Digit9") {
        event.preventDefault();
        const index = parseInt(event.code.replace("Digit", ""), 10) - 1;
        actions.selectTab?.(index);
        return;
      }

      if (!event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        actions.splitVertical?.();
        return;
      }

      if (event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        actions.splitHorizontal?.();
        return;
      }

      if (event.shiftKey && event.code === "BracketLeft") {
        event.preventDefault();
        actions.focusPrevPane?.();
        return;
      }

      if (event.shiftKey && event.code === "BracketRight") {
        event.preventDefault();
        actions.focusNextPane?.();
        return;
      }

      if (!event.shiftKey && event.code === "KeyB") {
        event.preventDefault();
        actions.toggleNav?.();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}
```

- [ ] **Step 9.2: Commit**

```
git add packages/app/lib/shortcuts.ts
git commit -m "feat(ui): Cmd/Ctrl+B shortcut for nav column toggle"
```

---

### Task 10: Refactor Canvas.web.tsx

**Files:**
- Modify: `packages/app/components/Canvas.web.tsx`

Remove the old `TitleBar` tab strip. Filter the grid by workpath. Wire Overview header + breadcrumb. The `activeTabId` prop becomes `zoomedTerminalId` (renaming); the grid condition becomes "show grid if not zoomed" regardless of scope.

- [ ] **Step 10.1: Rewrite Canvas.web.tsx**

```tsx
// packages/app/components/Canvas.web.tsx
import { memo, useRef, useState, useMemo, useCallback, useEffect } from "react";
import type { Bookmark, MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";
import type { TerminalCardRef } from "./TerminalCard.web";
import { OverviewHeader } from "./OverviewHeader.web";
import { TerminalBreadcrumb } from "./TerminalBreadcrumb.web";
import { colors } from "@/lib/colors";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { SplitPaneContainer } from "./SplitPaneContainer";
import {
  createLeaf,
  splitPane,
  removePane,
  updateRatio,
  getLeaves,
  type PaneNode,
  type PaneSplit,
} from "@/lib/paneLayout";
import { createTerminal } from "@/lib/api";

interface CanvasProps {
  machines: MachineInfo[];
  terminals: TerminalInfo[];
  bookmarks: Bookmark[];
  selectedWorkpathId: string | "all";
  zoomedTerminalId: string | null;
  activeMachineId: string | null;
  machineStats: Record<string, ResourceStats>;
  isMobile: boolean;
  isActiveController: boolean;
  isMachineController: (machineId: string) => boolean;
  deviceId: string;
  onZoomTerminal: (id: string) => void;
  onUnzoom: () => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
  onNewTerminal?: () => void;
  splitPaneRef?: React.MutableRefObject<{
    splitVertical: () => void;
    splitHorizontal: () => void;
    focusPrevPane: () => void;
    focusNextPane: () => void;
    closePane: () => void;
  } | null>;
}

function matchBookmark(bm: Bookmark, t: TerminalInfo): boolean {
  return t.machine_id === bm.machineId && t.cwd === bm.path;
}

function CanvasComponent(props: CanvasProps) {
  const {
    machines,
    terminals,
    bookmarks,
    selectedWorkpathId,
    zoomedTerminalId,
    activeMachineId,
    machineStats,
    isMobile,
    isActiveController,
    isMachineController,
    deviceId,
    onZoomTerminal,
    onUnzoom,
    onDestroy,
    onRequestControl,
    onReleaseControl,
    onNewTerminal,
    splitPaneRef,
  } = props;

  const activeMachine = activeMachineId
    ? machines.find((m) => m.id === activeMachineId) ?? null
    : machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;

  // Filter terminals by workpath selection.
  const scopeBookmark = selectedWorkpathId === "all"
    ? null
    : bookmarks.find((b) => b.id === selectedWorkpathId) ?? null;

  const scopedTerminals = useMemo(() => {
    if (selectedWorkpathId === "all") return terminals;
    if (!scopeBookmark) return [];
    return terminals.filter((t) => matchBookmark(scopeBookmark, t));
  }, [terminals, selectedWorkpathId, scopeBookmark]);

  const scopeLabel = selectedWorkpathId === "all"
    ? "All"
    : scopeBookmark?.label ?? "Workpath";

  // Pane layout state keyed by terminal id (zoomed terminal).
  const [paneLayouts, setPaneLayouts] = useState<Record<string, PaneNode>>({});
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const terminalCardRefs = useRef<Record<string, TerminalCardRef | null>>({});

  useEffect(() => {
    if (zoomedTerminalId && !paneLayouts[zoomedTerminalId]) {
      setPaneLayouts((prev) => ({
        ...prev,
        [zoomedTerminalId]: createLeaf(zoomedTerminalId),
      }));
      setActivePaneId(zoomedTerminalId);
    }
  }, [zoomedTerminalId, paneLayouts]);

  useEffect(() => {
    if (!zoomedTerminalId) return;
    const targetId = activePaneId || zoomedTerminalId;
    const rafId = requestAnimationFrame(() => {
      terminalCardRefs.current[targetId]?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [zoomedTerminalId, activePaneId]);

  useEffect(() => {
    const terminalIds = new Set(terminals.map((t) => t.id));
    setPaneLayouts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [tabId, layout] of Object.entries(next)) {
        let current: PaneNode | null = layout;
        for (const leaf of getLeaves(layout)) {
          if (!terminalIds.has(leaf.terminalId) && current) {
            current = removePane(current, leaf.terminalId);
            changed = true;
          }
        }
        if (current) next[tabId] = current;
        else delete next[tabId];
      }
      return changed ? next : prev;
    });
  }, [terminals]);

  const handleSplitPane = useCallback(
    async (direction: "horizontal" | "vertical") => {
      if (!zoomedTerminalId || !activePaneId || !activeMachine || !deviceId) return;
      if (!isMachineController(activeMachine.id)) return;
      const activeTerminalForSplit = terminals.find((t) => t.id === activePaneId);
      const cwd = activeTerminalForSplit?.cwd || "~";
      const newTerminal = await createTerminal(activeMachine.id, cwd, deviceId);
      setPaneLayouts((prev) => {
        const current = prev[zoomedTerminalId] || createLeaf(zoomedTerminalId);
        return {
          ...prev,
          [zoomedTerminalId]: splitPane(current, activePaneId, newTerminal.id, direction),
        };
      });
      setActivePaneId(newTerminal.id);
    },
    [zoomedTerminalId, activePaneId, activeMachine, deviceId, isMachineController, terminals],
  );

  const handleUpdateRatio = useCallback(
    (splitNode: PaneSplit, newRatio: number) => {
      if (!zoomedTerminalId) return;
      setPaneLayouts((prev) => {
        const current = prev[zoomedTerminalId];
        if (!current) return prev;
        return { ...prev, [zoomedTerminalId]: updateRatio(current, splitNode, newRatio) };
      });
    },
    [zoomedTerminalId],
  );

  const handleActivatePane = useCallback((id: string) => {
    setActivePaneId(id);
  }, []);

  const handleFocusPrevPane = useCallback(() => {
    if (!zoomedTerminalId) return;
    const layout = paneLayouts[zoomedTerminalId];
    if (!layout) return;
    const leaves = getLeaves(layout);
    const idx = leaves.findIndex((l) => l.terminalId === activePaneId);
    const prevIdx = (idx - 1 + leaves.length) % leaves.length;
    setActivePaneId(leaves[prevIdx].terminalId);
    terminalCardRefs.current[leaves[prevIdx].terminalId]?.focus();
  }, [zoomedTerminalId, paneLayouts, activePaneId]);

  const handleFocusNextPane = useCallback(() => {
    if (!zoomedTerminalId) return;
    const layout = paneLayouts[zoomedTerminalId];
    if (!layout) return;
    const leaves = getLeaves(layout);
    const idx = leaves.findIndex((l) => l.terminalId === activePaneId);
    const nextIdx = (idx + 1) % leaves.length;
    setActivePaneId(leaves[nextIdx].terminalId);
    terminalCardRefs.current[leaves[nextIdx].terminalId]?.focus();
  }, [zoomedTerminalId, paneLayouts, activePaneId]);

  const closePaneById = useCallback(
    (terminalId: string) => {
      if (!zoomedTerminalId) return;
      const terminal = terminals.find((t) => t.id === terminalId);
      if (!terminal) return;
      const layout = paneLayouts[zoomedTerminalId];
      if (terminalId === zoomedTerminalId && layout && layout.type === "split") {
        const remaining = removePane(layout, terminalId);
        if (remaining) {
          const newRoot = getLeaves(remaining)[0]?.terminalId;
          if (newRoot) {
            setPaneLayouts((prev) => {
              const copy = { ...prev };
              delete copy[zoomedTerminalId];
              copy[newRoot] = remaining;
              return copy;
            });
            setActivePaneId(newRoot);
            onZoomTerminal(newRoot);
          }
        }
      }
      onDestroy(terminal);
    },
    [zoomedTerminalId, paneLayouts, terminals, onDestroy, onZoomTerminal],
  );

  const handleClosePane = useCallback(() => {
    if (activePaneId) closePaneById(activePaneId);
  }, [activePaneId, closePaneById]);

  useEffect(() => {
    if (splitPaneRef) {
      splitPaneRef.current = {
        splitVertical: () => handleSplitPane("vertical"),
        splitHorizontal: () => handleSplitPane("horizontal"),
        focusPrevPane: handleFocusPrevPane,
        focusNextPane: handleFocusNextPane,
        closePane: handleClosePane,
      };
    }
    return () => {
      if (splitPaneRef) splitPaneRef.current = null;
    };
  }, [splitPaneRef, handleSplitPane, handleFocusPrevPane, handleFocusNextPane, handleClosePane]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null);
  const handleTerminalContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, terminalId });
  }, []);

  const openMenuFromBreadcrumb = useCallback((e: React.MouseEvent) => {
    if (!zoomedTerminalId) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, terminalId: zoomedTerminalId });
  }, [zoomedTerminalId]);

  // Keep hidden terminal mounts for non-scope terminals so state is preserved
  const renderedIds = useMemo(() => {
    const s = new Set<string>();
    if (zoomedTerminalId && paneLayouts[zoomedTerminalId]) {
      for (const leaf of getLeaves(paneLayouts[zoomedTerminalId])) s.add(leaf.terminalId);
    }
    return s;
  }, [zoomedTerminalId, paneLayouts]);

  const siblingsForBreadcrumb = useMemo(() => {
    if (!zoomedTerminalId) return [];
    if (selectedWorkpathId === "all") return terminals;
    return scopedTerminals;
  }, [zoomedTerminalId, selectedWorkpathId, terminals, scopedTerminals]);

  return (
    <main
      style={{
        flex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: colors.background,
      }}
    >
      {zoomedTerminalId && paneLayouts[zoomedTerminalId] ? (
        <>
          <TerminalBreadcrumb
            scopeLabel={scopeLabel}
            zoomedTerminalId={zoomedTerminalId}
            siblings={siblingsForBreadcrumb}
            onBack={onUnzoom}
            onSwitchSibling={(id) => onZoomTerminal(id)}
            onOpenMenu={openMenuFromBreadcrumb}
          />
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
        </>
      ) : (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: isMobile ? 12 : 20,
            paddingTop: isMobile ? 52 : 20,
          }}
        >
          <OverviewHeader
            machine={activeMachine}
            stats={activeStats}
            terminalCount={scopedTerminals.length}
            isController={isActiveController}
            canCreateTerminal={isActiveController}
            scopeLabel={`${scopeLabel}${scopeBookmark ? ` · ${scopeBookmark.path}` : ""}`}
            onRequestControl={onRequestControl && activeMachine
              ? () => onRequestControl(activeMachine.id)
              : undefined}
            onReleaseControl={onReleaseControl && activeMachine
              ? () => onReleaseControl(activeMachine.id)
              : undefined}
            onNewTerminal={onNewTerminal}
            isMobile={isMobile}
          />

          {scopedTerminals.length === 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 200,
                color: colors.foregroundMuted,
                fontSize: 14,
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>&#x2B21;</div>
                <div>
                  {selectedWorkpathId === "all"
                    ? "No terminals yet"
                    : `No terminals in ${scopeLabel}`}
                </div>
                {isActiveController && onNewTerminal && (
                  <button
                    data-testid="empty-new-terminal"
                    onClick={onNewTerminal}
                    style={{
                      marginTop: 12,
                      background: colors.accent,
                      color: colors.background,
                      border: "none",
                      borderRadius: 999,
                      padding: "8px 14px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Start terminal
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))",
                gap: isMobile ? 12 : 16,
                alignContent: "start",
              }}
            >
              {scopedTerminals.map((terminal) => (
                <TerminalCard
                  key={terminal.id}
                  terminal={terminal}
                  displayMode="card"
                  isMobile={isMobile}
                  isController={isMachineController(terminal.machine_id)}
                  deviceId={deviceId}
                  onSelectTab={(id) => { if (id) onZoomTerminal(id); }}
                  onDestroy={onDestroy}
                  onRequestControl={onRequestControl}
                  onReleaseControl={onReleaseControl}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hidden mount for terminals not currently in the zoomed pane */}
      {terminals
        .filter((t) => !renderedIds.has(t.id))
        .map((terminal) => (
          <div key={terminal.id} style={{ display: "none" }}>
            <TerminalCard
              ref={(el) => { terminalCardRefs.current[terminal.id] = el; }}
              terminal={terminal}
              displayMode="tab"
              isMobile={isMobile}
              isController={isMachineController(terminal.machine_id)}
              deviceId={deviceId}
              desktopPanelOpen={false}
              onSelectTab={(id) => { if (id) onZoomTerminal(id); }}
              onDestroy={onDestroy}
              onRequestControl={onRequestControl}
              onReleaseControl={onReleaseControl}
            />
          </div>
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "Copy", shortcut: "Ctrl+C", onClick: () => { document.execCommand("copy"); } },
            {
              label: "Paste",
              shortcut: "Ctrl+V",
              onClick: () => {
                terminalCardRefs.current[contextMenu.terminalId]?.focus();
              },
            },
            { type: "separator" as const },
            { label: "Split Vertically", shortcut: "Ctrl+\\", onClick: () => handleSplitPane("vertical") },
            { label: "Split Horizontally", shortcut: "Ctrl+Shift+\\", onClick: () => handleSplitPane("horizontal") },
            { type: "separator" as const },
            {
              label: "Clear Screen",
              onClick: () => {
                terminalCardRefs.current[contextMenu.terminalId]?.sendInput("\x0c");
              },
            },
            { type: "separator" as const },
            { label: "Close Pane", shortcut: "Ctrl+Shift+W", onClick: () => closePaneById(contextMenu.terminalId) },
          ] as ContextMenuEntry[]}
        />
      )}
    </main>
  );
}

export const Canvas = memo(CanvasComponent);
```

- [ ] **Step 10.2: Typecheck (may have errors until TerminalCanvas is updated)**

```
cd packages/app && pnpm exec tsc --noEmit
```

Expected: errors in `TerminalCanvas.web.tsx` because Canvas props changed. These get fixed in Task 11.

- [ ] **Step 10.3: Commit**

```
git add packages/app/components/Canvas.web.tsx
git commit -m "refactor(ui): Canvas uses workpath scope + breadcrumb + overview header"
```

---

### Task 11: Rewire TerminalCanvas.web.tsx

**Files:**
- Modify: `packages/app/components/TerminalCanvas.web.tsx`

Replace `Sidebar` with `NavColumn`. Adopt the main-layout reducer. Add `Esc` handler for unzoom. Wire new shortcut actions. Replace `TitleBar` with `AppTitleBar`.

- [ ] **Step 11.1: Apply full replacement**

The changes are large enough to warrant a full-file replacement. Preserve:
- Bootstrap / WebSocket effects (lines ~80–294)
- Control / destroy / terminal creation helpers
- StatusBar render at bottom
- Mobile sidebar drawer for small screens (keep `NavColumn` behavior but wrapped in existing mobile gate)

Apply the following diff-level changes:

1. Add imports:
```typescript
import { NavColumn } from "./NavColumn.web";
import { AppTitleBar } from "./AppTitleBar.web";
import {
  createInitialMainLayout,
  mainLayoutReducer,
} from "@/lib/mainLayoutReducer";
import { useReducer } from "react";
import { listBookmarks } from "@/lib/api";
import type { Bookmark } from "@webmux/shared";
```

2. Remove imports of `Sidebar` and (old) `TitleBar` reference chain.

3. Replace the `activeTabId` `useState` and all its uses with:
```typescript
const [layout, dispatchLayout] = useReducer(mainLayoutReducer, createInitialMainLayout());
```

4. Remove `activeTabRef` — replace usages with `layout.zoomedTerminalId`. The WebSocket `terminal_destroyed` handler becomes:
```typescript
if (
  next !== prev &&
  envelope.event?.type === "terminal_destroyed"
) {
  dispatchLayout({ type: "TERMINAL_DESTROYED", terminalId: envelope.event.terminal_id });
  if (layout.zoomedTerminalId === envelope.event.terminal_id) {
    window.history.pushState(null, "", window.location.pathname);
  }
}
```

5. URL hash sync uses `layout.zoomedTerminalId`. Replace the two hash-handling useEffects so that setting a zoomed id updates `#/t/<id>` and `UNZOOM` clears it.

6. Add bookmarks state loaded from `listBookmarks` for each active machine, fed into `NavColumn`. Store as `const [bookmarks, setBookmarks] = useState<Bookmark[]>([])` + effect:
```typescript
useEffect(() => {
  if (!activeMachineId) return;
  let cancelled = false;
  listBookmarks(activeMachineId)
    .then((bms) => { if (!cancelled) setBookmarks(bms); })
    .catch(() => { /* ignore */ });
  return () => { cancelled = true; };
}, [activeMachineId, terminals.length]);
```
(Re-fetch when terminals count changes so counts stay fresh after add/delete.)

7. Replace the `<Sidebar …/>` JSX with:
```tsx
{!isMobile && (
  <NavColumn
    machines={machines}
    activeMachineId={activeMachineId}
    bookmarks={bookmarks}
    terminals={terminals}
    selectedWorkpathId={layout.selectedWorkpathId}
    forceExpanded={layout.columnForceExpanded}
    canCreateTerminalForActiveMachine={isActiveController}
    onSelectMachine={(id) => setActiveMachineId(id)}
    onSelectAll={() => dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" })}
    onSelectWorkpath={(id) => dispatchLayout({ type: "SELECT_WORKPATH", workpathId: id })}
    onCreateTerminal={handleCreateTerminal}
    onRequestControl={handleRequestControl}
    onAddBookmark={() => { /* open settings or overlay's add path — defer */ }}
    onOpenSettings={() => setShowSettings(true)}
    onBookmarkDeleted={(id) => setBookmarks((prev) => prev.filter((b) => b.id !== id))}
  />
)}
{isMobile && sidebarOpen && (
  <Suspense fallback={null}>
    <NavColumn { ...same props }/>
  </Suspense>
)}
```

Keep the mobile backdrop + hamburger button; they continue to toggle `sidebarOpen` which in turn gates rendering.

8. Replace `handleSelectTab` with handlers that dispatch the reducer:
```typescript
const handleZoomTerminal = useCallback((id: string) => {
  dispatchLayout({ type: "ZOOM_TERMINAL", terminalId: id });
  window.history.pushState(null, "", `#/t/${id}`);
}, []);

const handleUnzoom = useCallback(() => {
  dispatchLayout({ type: "UNZOOM" });
  window.history.pushState(null, "", window.location.pathname);
}, []);
```

9. After creating a terminal, dispatch `TERMINAL_CREATED`. Also map cwd → workpathId (the bookmark whose machine + path matches). If no match, use `"all"`.
```typescript
const handleCreateTerminal = useCallback(
  async (machineId: string, cwd: string, startupCommand?: string) => {
    if (!deviceId) return;
    if (!isMachineController(machineId)) return;
    const newTerminal = await createTerminal(machineId, cwd, deviceId, startupCommand);
    const match = bookmarks.find((b) => b.machineId === machineId && b.path === cwd);
    dispatchLayout({
      type: "TERMINAL_CREATED",
      terminalId: newTerminal.id,
      workpathId: match?.id ?? "all",
    });
    window.history.pushState(null, "", `#/t/${newTerminal.id}`);
    if (isMobile) setSidebarOpen(false);
  },
  [deviceId, isMachineController, isMobile, bookmarks],
);
```

10. Replace shortcut wiring:
```typescript
const handleSelectWorkpathByIndex = useCallback(
  (index: number) => {
    if (index === 0) {
      dispatchLayout({ type: "SELECT_WORKPATH", workpathId: "all" });
      return;
    }
    const list = bookmarks.filter((b) => b.machineId === activeMachineId);
    const target = list[index - 1];
    if (target) dispatchLayout({ type: "SELECT_WORKPATH", workpathId: target.id });
  },
  [bookmarks, activeMachineId],
);

useShortcuts({
  newTerminal: isActiveController ? handleNewTerminalFromOverview : undefined,
  closeTab: handleCloseZoomedTerminal,
  closePane: isActiveController ? handleClosePane : undefined,
  nextTab: undefined, // deprecated with workpath-based navigation
  prevTab: undefined,
  selectTab: handleSelectWorkpathByIndex,
  splitVertical: isActiveController ? handleSplitVertical : undefined,
  splitHorizontal: isActiveController ? handleSplitHorizontal : undefined,
  focusPrevPane: handleFocusPrevPane,
  focusNextPane: handleFocusNextPane,
  toggleNav: () => dispatchLayout({ type: "TOGGLE_NAV_FORCE_EXPANDED" }),
});
```
where `handleCloseZoomedTerminal` closes the zoomed terminal if any (no-op otherwise) and `handleNewTerminalFromOverview` creates a terminal in the currently selected workpath (home dir for `all`).

11. Add `Esc` key listener while zoomed to trigger `UNZOOM`:
```typescript
useEffect(() => {
  if (!layout.zoomedTerminalId) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      // Don't steal when the user is typing in a terminal — terminals handle Esc.
      // Instead, only trigger when focus is not in an xterm textarea.
      const target = e.target as HTMLElement | null;
      if (target?.closest(".xterm")) return;
      dispatchLayout({ type: "UNZOOM" });
      window.history.pushState(null, "", window.location.pathname);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [layout.zoomedTerminalId]);
```

12. Replace `<Canvas …/>` props:
```tsx
<Canvas
  machines={machines}
  terminals={terminals}
  bookmarks={bookmarks}
  selectedWorkpathId={layout.selectedWorkpathId}
  zoomedTerminalId={layout.zoomedTerminalId}
  activeMachineId={activeMachine?.id ?? null}
  machineStats={machineStats}
  isMobile={isMobile}
  isActiveController={isActiveController}
  isMachineController={isMachineController}
  deviceId={deviceId ?? ""}
  onZoomTerminal={handleZoomTerminal}
  onUnzoom={handleUnzoom}
  onDestroy={handleDestroyTerminal}
  onRequestControl={handleRequestControl}
  onReleaseControl={handleReleaseControl}
  onNewTerminal={isActiveController ? handleNewTerminalFromOverview : undefined}
  splitPaneRef={splitPaneRef}
/>
```

13. Add `<AppTitleBar isMobile={isMobile} />` at the top of the root layout (above the main flex row) so window chrome renders once in Tauri builds; otherwise no-op.

- [ ] **Step 11.2: Typecheck**

```
cd packages/app && pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 11.3: Run vitest unit tests**

```
pnpm -w test
```

Expected: all existing unit tests + two new suites pass.

- [ ] **Step 11.4: Commit**

```
git add packages/app/components/TerminalCanvas.web.tsx
git commit -m "refactor(ui): wire NavColumn + main layout reducer into TerminalCanvas"
```

---

### Task 12: Remove dead code

**Files:**
- Delete: `packages/app/components/Sidebar.tsx`
- Delete: `packages/app/components/TitleBar.tsx`
- Modify: any remaining imports

- [ ] **Step 12.1: Delete old files and fix imports**

```
git rm packages/app/components/Sidebar.tsx packages/app/components/TitleBar.tsx
```

Search for any remaining imports:

```
grep -rn "from \"./Sidebar\"\|from \"./TitleBar\"\|components/Sidebar\|components/TitleBar" packages/app --include="*.ts" --include="*.tsx"
```

If anything turns up, either update to new components (`NavColumn` / `AppTitleBar`) or remove the import.

- [ ] **Step 12.2: Typecheck**

```
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 12.3: Commit**

```
git add -A
git commit -m "chore(ui): delete unused Sidebar and TitleBar components"
```

---

### Task 13: Update e2e helpers and tests

**Files:**
- Modify: `e2e/tests/helpers.ts`
- Modify: `e2e/tests/tab-navigation.spec.ts`
- Modify: `e2e/tests/quick-commands.spec.ts`
- Modify: `e2e/tests/core-control-flow.spec.ts`

The old tab strip test IDs (`tab-all`, `tab-<id>`) are gone. The old sidebar IDs (`machine-section-*`, `machine-bookmark-*`, `machine-request-control-*`) are replaced with `rail-*` and `overlay-*` equivalents.

- [ ] **Step 13.1: Update helpers.ts**

Replace old selectors with new ones. Key changes:

```typescript
// Old: "machine-section-e2e-node" → removed
// Old: "machine-bookmark-local-home" → "overlay-bookmark-local-home"
// New: to interact with bookmarks, first expand the nav column

export async function expandNavColumn(page: Page): Promise<void> {
  const rail = page.getByTestId("workpath-rail");
  await rail.hover();
  await expect(page.getByTestId("workpath-overlay")).toBeVisible();
}

export async function requestMachineControl(page: Page): Promise<void> {
  // Keep the API-level implementation unchanged (via /api/mode/control).
  // Leave as-is.
}

export async function openRootBookmark(page: Page): Promise<void> {
  const mobileToggle = page.getByTestId("mobile-sidebar-toggle");
  if (await mobileToggle.isVisible().catch(() => false)) {
    await mobileToggle.click();
  }
  await expandNavColumn(page);
  await page.getByTestId("overlay-bookmark-local-home").click();
}

// The old `expandMachineSection` helper is replaced by expandNavColumn.
export async function expandMachineSection(page: Page): Promise<void> {
  await expandNavColumn(page);
}
```

Update the `openApp` wait to include new selectors:

```typescript
await Promise.race([
  page.getByTestId("workpath-rail").waitFor({ state: "visible", timeout: 20_000 }),
  page.getByTestId("canvas-mode-toggle").waitFor({ state: "visible", timeout: 20_000 }),
  page.getByTestId("statusbar-mode-toggle").waitFor({ state: "visible", timeout: 20_000 }),
]);
```

- [ ] **Step 13.2: Update tab-navigation.spec.ts**

The test checks tab creation → URL hash sync → click All → click card → etc. Rewrite against the new model:

- "All" tab → `workpath-rail` / `overlay-select-all`
- Per-terminal tab → removed; zoomed state is verified by the presence of `terminal-breadcrumb` and `breadcrumb-back`
- "Click tab-X" → replaced by "click card in grid" (we already test that)
- New: verify clicking a workpath pill shows only its terminals, and clicking `All` shows everything

Full rewrite:

```typescript
import { test, expect } from "@playwright/test";
import {
  expandNavColumn,
  expectTerminalCount,
  getImmersiveTerminal,
  getTerminalCards,
  listTerminals,
  openApp,
  openRootBookmark,
  resetMachineState,
} from "./helpers";

test("workpath navigation: create, zoom, back, filter", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  // Initial state — no terminals, Overview visible.
  await expect(page.getByTestId("overview-header")).toBeVisible();

  // Take control and open a terminal from the "~" bookmark.
  await expandNavColumn(page);
  await page.getByTestId("overlay-request-control-e2e-node").click().catch(() => { /* already controlled */ });
  await page.getByTestId("overlay-bookmark-local-home").click();

  // After create → zoomed view
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect(page.getByTestId("terminal-breadcrumb")).toBeVisible();

  const terminals1 = await listTerminals(page);
  expect(terminals1).toHaveLength(1);
  const t1 = terminals1[0].id;
  expect(page.url()).toContain(`#/t/${t1}`);

  // Back to Overview via breadcrumb
  await page.getByTestId("breadcrumb-back").click();
  await expect(page.getByTestId("overview-header")).toBeVisible();
  await expectTerminalCount(page, 1);
  expect(page.url()).not.toContain("#/t/");

  // Zoom into card again
  await getTerminalCards(page).first().click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Esc returns to Overview
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("overview-header")).toBeVisible();

  // Create a second terminal from ~; should auto-zoom
  await openRootBookmark(page);
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  await expect(getImmersiveTerminal(page)).toBeVisible();
});
```

- [ ] **Step 13.3: Update other specs**

For `quick-commands.spec.ts` and `core-control-flow.spec.ts`, replace:
- `machine-section-e2e-node` → use `expandNavColumn`
- `machine-bookmark-<id>` → `overlay-bookmark-<id>`
- `machine-request-control-<id>` → `overlay-request-control-<id>`
- `quick-cmd-<label>` → `overlay-quick-cmd-<bookmarkId>-<label>`
- Any assertion that relied on `tab-all` being visible → assert on `overview-header` instead.

Run `grep` for old IDs to catch all sites:

```
grep -rn "machine-section-\|machine-bookmark-\|machine-request-control-\|quick-cmd-\|tab-all\|tab-\\\${" e2e/tests/
```

Update each occurrence.

- [ ] **Step 13.4: Run the e2e suite**

```
pnpm e2e:up
pnpm e2e:test
pnpm e2e:down
```

Expected: all specs green. If any fail, inspect and fix the helper or spec, not the new UI.

- [ ] **Step 13.5: Commit**

```
git add e2e/tests/
git commit -m "test(e2e): update selectors for vertical workpath nav"
```

---

### Task 14: Visual smoke test

Run the dev server and interact manually to confirm the UX matches the spec.

- [ ] **Step 14.1: Start dev server**

```
pnpm dev
```

Open `http://localhost:3000` (or whichever port the dev server prints).

- [ ] **Step 14.2: Checklist**

Confirm each of the following by interacting with the running app:

1. 56 px rail is visible on the left with `All` pill at top.
2. Hovering the rail reveals the 240 px overlay with full bookmark labels and quick-command chips.
3. Leaving the rail collapses the overlay after a short delay.
4. `Ctrl+B` (or `Cmd+B` on mac) force-expands the overlay and keeps it open until pressed again.
5. Clicking a workpath pill with terminals shows that workpath's Overview grid and only its cards.
6. Clicking `All` shows every terminal across every workpath.
7. Clicking a card zooms into the terminal; breadcrumb shows `← <workpath> / Overview` plus sibling chips.
8. Clicking a sibling chip in the breadcrumb swaps the zoomed terminal (URL hash updates).
9. `Esc` from the zoomed view returns to Overview (unless focus is in the terminal, in which case the terminal consumes it — expected).
10. Clicking a workpath pill with 0 terminals creates a new terminal and auto-zooms.
11. `Ctrl+T` creates a terminal in the current workpath and auto-zooms; in `All`, it falls back to home dir.
12. `Ctrl+W` from zoomed view closes that terminal and returns to the Overview.
13. Split-pane shortcuts (`Ctrl+\`, `Ctrl+Shift+\`, `Ctrl+Shift+W`) still work against the zoomed terminal.
14. Live/idle dot + count on rail pills updates when terminals are created and destroyed.
15. StatusBar at the bottom still shows machine name + stats + mode toggle.

If any item fails, open the failing case in an issue/note, fix it, re-verify. Do not move on until all 15 pass.

- [ ] **Step 14.3: Commit any fixes**

```
git add -A
git commit -m "fix(ui): smoke-test corrections"
```

(Only if corrections were needed.)

---

### Task 15: Push and create PR

- [ ] **Step 15.1: Push branch**

```
git push -u origin main-ui-redesign
```

- [ ] **Step 15.2: Open PR**

```
gh pr create --title "feat(ui): vertical workpath nav + collapsible sidebar" --body "$(cat <<'EOF'
## Summary
- Replaces the horizontal per-terminal tab strip and always-visible 260 px sidebar with a 56 px vertical workpath rail (expanding to 240 px overlay on hover or `Cmd/Ctrl+B`).
- Tabs are now workpath-scoped; individual terminals live inside an Overview grid, with a breadcrumb-based zoomed view for active work.
- Covers the design spec at `docs/superpowers/specs/2026-04-17-main-ui-redesign-design.md`.

## Test plan
- [ ] `pnpm test` passes (vitest unit suites).
- [ ] `pnpm e2e:test` passes (Playwright).
- [ ] Manual smoke (dev server): nav hover/force-expand, workpath scoping, card zoom, breadcrumb sibling switch, Esc unzoom, create-then-zoom, split panes still work.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL when the command completes.

---

## Self-Review Notes

- **Spec coverage:** Sections 4.1 (rail + overlay), 4.2 (Overview header + grid filter), 4.3 (breadcrumb + zoom), 5 (selection table), 6 (shortcuts), 7 (state transitions), 8 (file inventory matches §8 of spec).
- **Placeholder check:** No `TBD`/`TODO`/"implement later".
- **Type consistency:** `selectedWorkpathId`, `zoomedTerminalId`, `columnForceExpanded` match across reducer, NavColumn, Canvas, TerminalCanvas. `WorkpathRail` owns `workpaths: RailWorkpath[]`; `NavColumn` computes and passes it. `Bookmark.machineId` and `Bookmark.path` are the matching keys throughout.
- **Known edges deferred:** The `onAddBookmark` handler in `NavColumn` is hooked but no standalone directory picker is provided outside the overlay's existing `+ Add directory`. If users want to add a bookmark with the column collapsed, they'll hover-expand first. Acceptable given the design intent (hover-first).

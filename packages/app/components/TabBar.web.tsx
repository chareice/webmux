// Desktop tab bar — the single permanent chrome row of the D1 shell.
// Left: one tab per workspace group (persistent groups + cwd fallback
// groups, same grouping TerminalWorkspace computes) plus a ＋ button for a
// new terminal. Right: host meta — online dot + machine name (HostSwitcher
// dropdown), real cpu/mem micro-meters, and a "viewing" pill that only
// appears while the user is not the controller.
//
// The active tab is filled with the terminal background so it visually
// merges into the terminal below, like a terminal-emulator tab. Tabs of
// persistent groups can be reordered by dragging (same mouse-drag protocol
// the old workspace toolbar strip used — no new DnD library).

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type {
  MachineInfo,
  ResourceStats,
  TerminalInfo,
} from "@webmux/shared";
import { Lock, Plus } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
import { displayTerminalTitle } from "@/lib/displayTerminalTitle";
import { collectPaneTerminalIds, type WorkspaceGroup } from "@/lib/terminalWorkspaceLayout";
import { HostSwitcher } from "./HostSwitcher.web";

export type TabDropPlacement = "before" | "after";

interface TabBarProps {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  terminalsById: Map<string, TerminalInfo>;
  // All terminals across machines (HostSwitcher shows per-machine counts).
  terminals: TerminalInfo[];
  machines: MachineInfo[];
  activeMachineId: string | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  machineStats: Record<string, ResourceStats>;
  stats: ResourceStats | undefined;
  rttMs: number | null;
  isController: boolean;
  viewOnlyLocked: boolean;
  canCreateTerminal: boolean;
  onSelectGroup: (groupId: string) => void;
  onNewGroup: () => void;
  onDeleteGroup: (group: WorkspaceGroup) => void;
  onReorderGroups: (
    sourceGroupId: string,
    targetGroupId: string,
    placement: TabDropPlacement,
  ) => void;
  onNewTerminal: () => void;
  onSelectMachine: (id: string) => void;
  onAddMachine: () => void;
  onRequestControl: () => void;
  onEngageViewOnly: () => void;
  onDisengageViewOnly: () => void;
}

function TabBarComponent({
  groups,
  activeGroupId,
  terminalsById,
  terminals,
  machines,
  activeMachineId,
  controlLeases,
  deviceId,
  machineStats,
  stats,
  rttMs,
  isController,
  viewOnlyLocked,
  canCreateTerminal,
  onSelectGroup,
  onNewGroup,
  onDeleteGroup,
  onReorderGroups,
  onNewTerminal,
  onSelectMachine,
  onAddMachine,
  onRequestControl,
  onEngageViewOnly,
  onDisengageViewOnly,
}: TabBarProps) {
  // ---- tab drag-to-reorder (persistent groups only) ----
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const groupDragRef = useRef<{ sourceGroupId: string } | null>(null);
  const documentGroupDragCleanupRef = useRef<(() => void) | null>(null);

  const removeDocumentGroupDragEnd = useCallback(() => {
    const cleanup = documentGroupDragCleanupRef.current;
    if (!cleanup) return;
    cleanup();
    documentGroupDragCleanupRef.current = null;
  }, []);

  const resetGroupDrag = useCallback(() => {
    removeDocumentGroupDragEnd();
    groupDragRef.current = null;
    setDraggingGroupId(null);
  }, [removeDocumentGroupDragEnd]);

  const finishGroupDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = groupDragRef.current;
      resetGroupDrag();
      if (!drag) return;
      const target = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-workspace-group-drop-id]");
      const targetGroupId = target?.dataset.workspaceGroupDropId;
      if (!targetGroupId || targetGroupId === drag.sourceGroupId) return;
      const rect = target.getBoundingClientRect();
      const placement: TabDropPlacement =
        clientX < rect.left + rect.width / 2 ? "before" : "after";
      onReorderGroups(drag.sourceGroupId, targetGroupId, placement);
    },
    [onReorderGroups, resetGroupDrag],
  );

  const startGroupMouseDrag = useCallback(
    (sourceGroupId: string, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      removeDocumentGroupDragEnd();
      groupDragRef.current = { sourceGroupId };
      setDraggingGroupId(sourceGroupId);
      const handleMouseUp = (mouseEvent: MouseEvent) => {
        removeDocumentGroupDragEnd();
        finishGroupDrag(mouseEvent.clientX, mouseEvent.clientY);
      };
      const handleWindowBlur = () => resetGroupDrag();
      documentGroupDragCleanupRef.current = () => {
        document.removeEventListener("mouseup", handleMouseUp, true);
        window.removeEventListener("blur", handleWindowBlur, true);
      };
      document.addEventListener("mouseup", handleMouseUp, true);
      window.addEventListener("blur", handleWindowBlur, true);
    },
    [finishGroupDrag, removeDocumentGroupDragEnd, resetGroupDrag],
  );

  useEffect(
    () => () => {
      removeDocumentGroupDragEnd();
    },
    [removeDocumentGroupDragEnd],
  );

  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    group: WorkspaceGroup;
    x: number;
    y: number;
  } | null>(null);

  // Menu content must be referentially stable while open: the bar re-renders
  // every second with fresh stats, and an unstable subtree makes the menu
  // jitter (Playwright "element is not stable" flakes on slow runners).
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  const tabMenuItems = useMemo<ContextMenuEntry[]>(
    () =>
      tabMenu
        ? [
            {
              label: "New tab",
              disabled: !isController,
              onClick: onNewGroup,
            },
            { type: "separator" },
            {
              label: `Delete tab "${tabMenu.group.label}"`,
              // cwd fallback groups only exist while their panes do — there
              // is nothing to delete; persistent groups are user-owned rows.
              disabled: !tabMenu.group.persistent || !isController,
              onClick: () => onDeleteGroup(tabMenu.group),
            },
          ]
        : [],
    [tabMenu, isController, onNewGroup, onDeleteGroup],
  );

  return (
    <div
      data-testid="tab-bar"
      style={{
        height: 34,
        flexShrink: 0,
        display: "flex",
        alignItems: "stretch",
        background: colors.bg0,
        borderBottom: `1px solid ${colors.lineSoft}`,
        minWidth: 0,
        userSelect: "none",
      }}
    >
      {/* Left: group tabs + new-terminal button */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 2,
          paddingLeft: 6,
          overflowX: "auto",
          minWidth: 0,
          flex: 1,
        }}
      >
        {groups.map((group) => {
          const active = group.id === activeGroupId;
          const annotation = groupAnnotation(group, terminalsById);
          return (
            <div
              key={group.id}
              data-workspace-group-drop-id={
                group.persistent ? group.id : undefined
              }
              onMouseEnter={() => {
                setHoveredGroupId(group.id);
                if (
                  group.id !== activeGroupId &&
                  groupDragRef.current === null
                ) {
                  onSelectGroup(group.id);
                }
              }}
              onMouseLeave={() =>
                setHoveredGroupId((current) =>
                  current === group.id ? null : current,
                )
              }
              onContextMenu={(event) => {
                event.preventDefault();
                setTabMenu({ group, x: event.clientX, y: event.clientY });
              }}
              data-testid={`workspace-tab-${group.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 0,
                padding: "0 2px",
                marginTop: 4,
                // The active tab reaches 1px past the bar's bottom border so
                // its terminal-background fill merges into the terminal below.
                marginBottom: active ? -1 : 0,
                position: "relative",
                borderRadius: "7px 7px 0 0",
                background: active
                  ? terminalTheme.background
                  : hoveredGroupId === group.id
                    ? colors.bg2
                    : "transparent",
                border: active
                  ? `1px solid ${colors.lineSoft}`
                  : "1px solid transparent",
                borderBottom: active ? "none" : "1px solid transparent",
                flexShrink: 0,
                maxWidth: 220,
                opacity: draggingGroupId === group.id ? 0.5 : 1,
              }}
            >
              {group.persistent && (
                <span
                  role="button"
                  tabIndex={-1}
                  data-testid={`workspace-group-drag-${group.id}`}
                  title="Drag group"
                  aria-label={`Drag group ${group.label}`}
                  onMouseDown={(event) => startGroupMouseDrag(group.id, event)}
                  style={dragHandleStyle}
                >
                  <span style={dragGripStyle} />
                </span>
              )}
              <button
                type="button"
                onClick={() => onSelectGroup(group.id)}
                data-testid={`workspace-group-${group.id}`}
                title={group.label}
                style={{
                  ...tabButtonStyle,
                  color: active ? colors.fg0 : colors.fg2,
                }}
              >
                <span style={truncateStyle}>{group.label}</span>
                {annotation && (
                  <span
                    style={{
                      color: colors.fg3,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      ...truncateStyle,
                    }}
                  >
                    {annotation}
                  </span>
                )}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          data-testid="tab-bar-new-terminal"
          onClick={onNewTerminal}
          disabled={!canCreateTerminal}
          title="New terminal"
          aria-label="New terminal"
          style={{
            alignSelf: "center",
            width: 26,
            height: 26,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: colors.fg2,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            flexShrink: 0,
            cursor: canCreateTerminal ? "pointer" : "not-allowed",
            opacity: canCreateTerminal ? 1 : 0.45,
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenuItems}
          onClose={closeTabMenu}
        />
      )}

      {/* Right: host meta */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 10px",
          flexShrink: 0,
        }}
      >
        <HostSwitcher
          compact
          machines={machines}
          activeMachineId={activeMachineId}
          controlLeases={controlLeases}
          deviceId={deviceId}
          machineStats={machineStats}
          terminals={terminals}
          onSelectMachine={onSelectMachine}
          onAddMachine={onAddMachine}
        />
        <MicroMeters stats={stats} />
        <span
          data-testid="tab-bar-rtt"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: colors.fg1,
            minWidth: 34,
            textAlign: "right",
          }}
        >
          {rttMs === null ? "—" : `${Math.round(rttMs)}ms`}
        </span>
        {viewOnlyLocked ? (
          <button
            type="button"
            data-testid="workbench-request-control"
            onClick={onDisengageViewOnly}
            title="Unlock input claims"
            style={controlPillStyle}
          >
            🔒 view only
          </button>
        ) : !isController ? (
          <button
            type="button"
            data-testid="workbench-request-control"
            onClick={onRequestControl}
            title="Take control"
            style={controlPillStyle}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: colors.fg2,
              }}
            />
            viewing
          </button>
        ) : (
          <button
            type="button"
            data-testid="workbench-view-only-lock"
            onClick={onEngageViewOnly}
            title="Lock to view only"
            aria-label="Lock to view only"
            style={{
              width: 24,
              height: 24,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              borderRadius: 6,
              background: "transparent",
              border: `1px solid ${colors.line}`,
              color: colors.fg2,
              cursor: "pointer",
            }}
          >
            <Lock size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export const TabBar = memo(TabBarComponent);

const controlPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 22,
  padding: "0 9px",
  borderRadius: 999,
  background: colorAlpha.mutedLight,
  border: `1px solid ${colors.line}`,
  color: colors.fg2,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/* ---------- tab annotation ---------- */

// Distinct pane titles joined with ▏ (deduped, max 2 shown then +N).
// Hidden when the group has a single pane whose title equals the label.
function groupAnnotation(
  group: WorkspaceGroup,
  terminalsById: Map<string, TerminalInfo>,
): string | null {
  const paneIds = collectPaneTerminalIds(group.root);
  const titles: string[] = [];
  for (const id of paneIds) {
    const terminal = terminalsById.get(id);
    if (!terminal) continue;
    const title = displayTerminalTitle(terminal);
    if (!titles.includes(title)) titles.push(title);
  }
  if (titles.length === 0) return null;
  if (paneIds.length === 1 && titles.length === 1 && titles[0] === group.label) {
    return null;
  }
  const shown = titles.slice(0, 2).join(" ▏");
  return titles.length > 2 ? `${shown} +${titles.length - 2}` : shown;
}

/* ---------- cpu/mem micro-meters ---------- */

function MicroMeters({ stats }: { stats: ResourceStats | undefined }) {
  const cpu = stats ? Math.round(stats.cpu_percent) : null;
  const mem =
    stats && stats.memory_total > 0
      ? Math.round((stats.memory_used / stats.memory_total) * 100)
      : null;
  return (
    <div
      data-testid="tab-bar-meters"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: colors.fg3,
      }}
    >
      <Meter label="cpu" percent={cpu} />
      <Meter label="mem" percent={mem} />
    </div>
  );
}

function Meter({ label, percent }: { label: string; percent: number | null }) {
  return (
    <span
      data-testid={`tab-bar-meter-${label}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
    >
      <span>{label}</span>
      <span
        style={{
          width: 30,
          height: 4,
          borderRadius: 2,
          background: colors.bg2,
          overflow: "hidden",
          display: "inline-block",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${percent ?? 0}%`,
            background: percent === null ? "transparent" : colors.fg2,
            borderRadius: 2,
          }}
        />
      </span>
      <span style={{ color: colors.fg1, minWidth: 32, textAlign: "right" }}>
        {percent === null ? "—" : `${percent}%`}
      </span>
    </span>
  );
}

/* ---------- styles ---------- */

const tabButtonStyle: CSSProperties = {
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: "none",
  background: "transparent",
  padding: "0 8px",
  height: "100%",
  fontSize: 12,
  cursor: "pointer",
};

const dragHandleStyle: CSSProperties = {
  width: 10,
  height: 20,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "grab",
  flexShrink: 0,
  touchAction: "none",
  userSelect: "none",
};

// Two vertical dotted columns, like a window-manager drag grip.
const dragGripStyle: CSSProperties = {
  width: 6,
  height: 10,
  backgroundImage: `radial-gradient(${colors.fg3} 1px, transparent 1px)`,
  backgroundSize: "3px 3px",
  opacity: 0.8,
};

const truncateStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

// Desktop left sidebar — the permanent chrome column of the D2 shell.
// Top: hosts rail (one row per machine with online dot, cpu/mem/disk
// micro-meters, and the hub RTT once in the rail header; clicking a host
// toggles a filter that dims the other machines' tree sections — it is a
// qualifier, not a mode switch). Middle: the project → session tree,
// machine divider label above each machine's workspace-group sections,
// sections ordered by sort_order, rows = the group's pane terminals.
// Bottom: control-lease pill (Control / viewing / view only), settings,
// sign out.
//
// Section drag-to-reorder reuses the TabBar's mouse-drag protocol, flipped
// vertical: press arms a drag, 4px of movement promotes it, drop target is
// found via elementFromPoint on [data-workspace-group-drop-id] and the drop
// placement comes from the pointer's position against the target's
// vertical midpoint. Drags only apply within the active machine — the
// reorder command channel is scoped to the mounted workspace.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { ResourceStats } from "@webmux/shared";
import { ChevronDown, Lock, LogOut, MessageCircle, Plus, Settings } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { colors, colorAlpha } from "@/lib/colors";
import { diskPercent, diskTooltip } from "@/lib/resourceStats";
import type { SidebarRow, SidebarSection, SidebarTree } from "@/lib/sidebarTree";
import { getAgentSessionPendingQuestion } from "@/lib/agentSessionFeed";
import type { WorkspaceGroup } from "@/lib/terminalWorkspaceLayout";
import { AgentBadge, AgentStatusDot } from "./AgentBadge.web";

export type SidebarDropPlacement = "before" | "after";

// Distance (px) a press on the section header must travel before it
// becomes a drag (same threshold the TabBar used).
const SECTION_DRAG_THRESHOLD_PX = 4;

interface SidebarProps {
  tree: SidebarTree;
  machineStats: Record<string, ResourceStats>;
  rttMs: number | null;
  hostFilterId: string | null;
  activeMachineId: string | null;
  isControllerFor: (machineId: string) => boolean;
  // Control-lease state of the ACTIVE machine (the workspace on the right).
  isActiveController: boolean;
  viewOnlyLocked: boolean;
  onToggleHostFilter: (machineId: string) => void;
  onAddMachine: () => void;
  onSelectSection: (machineId: string, groupId: string) => void;
  onSelectRow: (machineId: string, groupId: string, terminalId: string) => void;
  onSelectAgentRow: (machineId: string, agentSessionId: string) => void;
  onNewTab: () => void;
  onNewTerminalInSection: (machineId: string, group: WorkspaceGroup) => void;
  /** Project-level ＋ → "New agent chat": instant create in that project's
   *  cwd with the remembered agent+model, no dialog. */
  onNewAgentChatInSection: (machineId: string, group: WorkspaceGroup) => void;
  onRenameSection: (machineId: string, group: WorkspaceGroup) => void;
  onDeleteSection: (machineId: string, group: WorkspaceGroup) => void;
  onReorderSections: (
    sourceGroupId: string,
    targetGroupId: string,
    placement: SidebarDropPlacement,
  ) => void;
  onRequestControl: () => void;
  onEngageViewOnly: () => void;
  onDisengageViewOnly: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

function SidebarComponent({
  tree,
  machineStats,
  rttMs,
  hostFilterId,
  activeMachineId,
  isControllerFor,
  isActiveController,
  viewOnlyLocked,
  onToggleHostFilter,
  onAddMachine,
  onSelectSection,
  onSelectRow,
  onSelectAgentRow,
  onNewTab,
  onNewTerminalInSection,
  onNewAgentChatInSection,
  onRenameSection,
  onDeleteSection,
  onReorderSections,
  onRequestControl,
  onEngageViewOnly,
  onDisengageViewOnly,
  onOpenSettings,
  onSignOut,
}: SidebarProps) {
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sectionMenu, setSectionMenu] = useState<{
    machineId: string;
    group: WorkspaceGroup;
    x: number;
    y: number;
  } | null>(null);
  // The section header ＋ menu: New agent chat (instant, remembered defaults)
  // or New terminal here (the old direct behavior).
  const [plusMenu, setPlusMenu] = useState<{
    machineId: string;
    group: WorkspaceGroup;
    x: number;
    y: number;
  } | null>(null);

  // ---- section drag-to-reorder (vertical port of the TabBar drag) ----
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const sectionDragRef = useRef<{ sourceGroupId: string } | null>(null);
  const documentDragCleanupRef = useRef<(() => void) | null>(null);
  const sectionDragPendingRef = useRef<{
    sourceGroupId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressSectionClickRef = useRef(false);

  const removeDocumentDragEnd = useCallback(() => {
    const cleanup = documentDragCleanupRef.current;
    if (!cleanup) return;
    cleanup();
    documentDragCleanupRef.current = null;
  }, []);

  const resetSectionDrag = useCallback(() => {
    removeDocumentDragEnd();
    sectionDragRef.current = null;
    setDraggingGroupId(null);
  }, [removeDocumentDragEnd]);

  const sectionMachineById = useMemo(() => {
    const map = new Map<string, string>();
    for (const machine of tree.machines) {
      for (const section of machine.sections) {
        map.set(section.groupId, machine.machineId);
      }
    }
    return map;
  }, [tree]);

  const finishSectionDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = sectionDragRef.current;
      resetSectionDrag();
      if (!drag) return;
      // Swallow the click that fires after this mouseup so ending a drag
      // never (re-)selects a section.
      suppressSectionClickRef.current = true;
      setTimeout(() => {
        suppressSectionClickRef.current = false;
      }, 0);
      const target = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-workspace-group-drop-id]");
      const targetGroupId = target?.dataset.workspaceGroupDropId;
      if (!targetGroupId || targetGroupId === drag.sourceGroupId) return;
      // Reorders go through the active machine's workspace channel — a drop
      // on another machine's section is not a reorder.
      const sourceMachineId = sectionMachineById.get(drag.sourceGroupId);
      const targetMachineId = sectionMachineById.get(targetGroupId);
      if (
        !sourceMachineId ||
        sourceMachineId !== targetMachineId ||
        sourceMachineId !== activeMachineId
      ) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const placement: SidebarDropPlacement =
        clientY < rect.top + rect.height / 2 ? "before" : "after";
      onReorderSections(drag.sourceGroupId, targetGroupId, placement);
    },
    [activeMachineId, onReorderSections, resetSectionDrag, sectionMachineById],
  );

  const beginSectionDrag = useCallback(
    (sourceGroupId: string) => {
      removeDocumentDragEnd();
      sectionDragRef.current = { sourceGroupId };
      setDraggingGroupId(sourceGroupId);
      const handleMouseUp = (mouseEvent: MouseEvent) => {
        removeDocumentDragEnd();
        finishSectionDrag(mouseEvent.clientX, mouseEvent.clientY);
      };
      const handleWindowBlur = () => resetSectionDrag();
      documentDragCleanupRef.current = () => {
        document.removeEventListener("mouseup", handleMouseUp, true);
        window.removeEventListener("blur", handleWindowBlur);
      };
      document.addEventListener("mouseup", handleMouseUp, true);
      // Non-capture on purpose, same reasoning as the TabBar drag: terminal
      // blur events must not cancel the drag, only a genuine window blur.
      window.addEventListener("blur", handleWindowBlur);
    },
    [finishSectionDrag, removeDocumentDragEnd, resetSectionDrag],
  );

  const startSectionMouseDrag = useCallback(
    (sourceGroupId: string, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      beginSectionDrag(sourceGroupId);
    },
    [beginSectionDrag],
  );

  // Pressing a section header arms a drag: moving past the threshold
  // promotes it, releasing earlier behaves like a plain click.
  const armSectionDrag = useCallback(
    (sourceGroupId: string, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (sectionDragRef.current) return;
      removeDocumentDragEnd();
      sectionDragPendingRef.current = {
        sourceGroupId,
        startX: event.clientX,
        startY: event.clientY,
      };
      const cancelPending = () => {
        sectionDragPendingRef.current = null;
        removeDocumentDragEnd();
      };
      const handleMouseMove = (mouseEvent: MouseEvent) => {
        const pending = sectionDragPendingRef.current;
        if (!pending) return;
        const dx = mouseEvent.clientX - pending.startX;
        const dy = mouseEvent.clientY - pending.startY;
        if (Math.hypot(dx, dy) < SECTION_DRAG_THRESHOLD_PX) return;
        cancelPending();
        beginSectionDrag(pending.sourceGroupId);
      };
      const handleMouseUp = () => cancelPending();
      const handleWindowBlur = () => cancelPending();
      documentDragCleanupRef.current = () => {
        document.removeEventListener("mousemove", handleMouseMove, true);
        document.removeEventListener("mouseup", handleMouseUp, true);
        window.removeEventListener("blur", handleWindowBlur);
      };
      document.addEventListener("mousemove", handleMouseMove, true);
      document.addEventListener("mouseup", handleMouseUp, true);
      window.addEventListener("blur", handleWindowBlur);
    },
    [beginSectionDrag, removeDocumentDragEnd],
  );

  useEffect(
    () => () => {
      removeDocumentDragEnd();
    },
    [removeDocumentDragEnd],
  );

  const closeSectionMenu = useCallback(() => setSectionMenu(null), []);
  const closePlusMenu = useCallback(() => setPlusMenu(null), []);
  const plusMenuItems = useMemo<ContextMenuEntry[]>(() => {
    if (!plusMenu) return [];
    const canControl = isControllerFor(plusMenu.machineId);
    return [
      {
        label: "New agent chat",
        disabled: !canControl,
        onClick: () =>
          onNewAgentChatInSection(plusMenu.machineId, plusMenu.group),
      },
      {
        label: "New terminal here",
        disabled: !canControl,
        onClick: () =>
          onNewTerminalInSection(plusMenu.machineId, plusMenu.group),
      },
    ];
  }, [plusMenu, isControllerFor, onNewAgentChatInSection, onNewTerminalInSection]);
  const sectionMenuItems = useMemo<ContextMenuEntry[]>(() => {
    if (!sectionMenu) return [];
    const canControl = isControllerFor(sectionMenu.machineId);
    return [
      {
        label: "New terminal here",
        disabled: !canControl,
        onClick: () =>
          onNewTerminalInSection(sectionMenu.machineId, sectionMenu.group),
      },
      { type: "separator" },
      {
        label: "Rename tab",
        // Same gate as delete: cwd fallback groups have no persisted row to
        // rename, and only the machine's controller may mutate tabs.
        disabled: !sectionMenu.group.persistent || !canControl,
        onClick: () =>
          onRenameSection(sectionMenu.machineId, sectionMenu.group),
      },
      {
        label: `Delete tab "${sectionMenu.group.label}"`,
        disabled: !sectionMenu.group.persistent || !canControl,
        onClick: () =>
          onDeleteSection(sectionMenu.machineId, sectionMenu.group),
      },
    ];
  }, [
    sectionMenu,
    isControllerFor,
    onNewTerminalInSection,
    onRenameSection,
    onDeleteSection,
  ]);

  return (
    <div
      data-testid="sidebar"
      style={{
        width: 260,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg1,
        borderRight: `1px solid ${colors.line}`,
        userSelect: "none",
        minHeight: 0,
      }}
    >
      {/* brand row */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px 0 12px",
          borderBottom: `1px solid ${colors.lineSoft}`,
        }}
      >
        <Logomark />
        <div
          style={{
            flexGrow: 1,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: colors.fg2,
          }}
        >
          WEBMUX
        </div>
        <button
          type="button"
          data-testid="sidebar-new-tab"
          onClick={onNewTab}
          disabled={!isActiveController}
          title="New session"
          aria-label="New session"
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: colors.bg2,
            border: `1px solid ${colors.line}`,
            color: colors.fg1,
            padding: 0,
            flexShrink: 0,
            cursor: isActiveController ? "pointer" : "not-allowed",
            opacity: isActiveController ? 1 : 0.45,
          }}
        >
          <Plus size={13} />
        </button>
      </div>

      {/* hosts rail */}
      <div
        style={{
          flexShrink: 0,
          padding: "8px 8px 6px",
          borderBottom: `1px solid ${colors.lineSoft}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 22,
            padding: "0 4px",
          }}
        >
          <div
            style={{
              flexGrow: 1,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.2,
              color: colors.fg3,
            }}
          >
            HOSTS
          </div>
          <span
            data-testid="sidebar-rtt"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.fg3,
            }}
          >
            {rttMs === null ? "—" : `${Math.round(rttMs)}ms`}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.fg3,
            }}
          >
            {tree.machines.length}
          </span>
          <button
            type="button"
            data-testid="sidebar-add-host"
            onClick={onAddMachine}
            title="Add host"
            aria-label="Add host"
            style={{
              width: 18,
              height: 18,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: colors.fg3,
              padding: 0,
              cursor: "pointer",
            }}
          >
            <Plus size={11} />
          </button>
        </div>

        {tree.machines.map((machine) => {
          const isActive = machine.machineId === activeMachineId;
          const isFilteredIn = hostFilterId === machine.machineId;
          return (
            <button
              key={machine.machineId}
              type="button"
              data-testid={`sidebar-host-${machine.machineId}`}
              onClick={() => onToggleHostFilter(machine.machineId)}
              title={
                isFilteredIn ? "Show all hosts" : `Show only ${machine.name}`
              }
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "5px 7px 6px",
                borderRadius: 6,
                border: "none",
                background: isActive || isFilteredIn ? colors.bg2 : "transparent",
                marginBottom: 2,
                cursor: "pointer",
                opacity: machine.dimmed ? 0.55 : 1,
              }}
            >
              <span
                style={{ display: "flex", alignItems: "center", gap: 7 }}
              >
                <HostDot online={machine.online} />
                <span
                  style={{
                    flexGrow: 1,
                    fontSize: 12.5,
                    fontWeight: isActive ? 500 : 400,
                    color: machine.online
                      ? isActive
                        ? colors.fg0
                        : colors.fg1
                      : colors.fg3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {machine.name}
                </span>
              </span>
              <MicroMeters
                stats={machineStats[machine.machineId]}
                testIdPrefix={`sidebar-host-${machine.machineId}`}
              />
            </button>
          );
        })}
      </div>

      {/* "waiting on you" inbox — only while ≥1 agent session is asked */}
      {tree.askedSessions.length > 0 && (
        <InboxBanner
          tree={tree}
          open={inboxOpen}
          onToggle={() => setInboxOpen((value) => !value)}
          onSelectSession={(machineId, sessionId) => {
            setInboxOpen(false);
            onSelectAgentRow(machineId, sessionId);
          }}
        />
      )}

      {/* session tree */}
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 8px 0",
        }}
      >
        {tree.machines.map((machine, machineIndex) => {
          if (machine.sections.length === 0) return null;
          return (
            <div
              key={machine.machineId}
              data-testid={`sidebar-machine-${machine.machineId}`}
              style={{
                opacity: machine.dimmed ? 0.45 : 1,
                marginTop: machineIndex === 0 ? 0 : 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: 22,
                  padding: "0 4px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  color: colors.fg3,
                  textTransform: "uppercase",
                }}
              >
                {machine.name}
              </div>
              {machine.sections.map((section) => (
                <SidebarSectionBlock
                  key={section.groupId}
                  section={section}
                  canDrag={
                    !machine.dimmed && machine.machineId === activeMachineId
                  }
                  dragging={draggingGroupId === section.groupId}
                  hovered={hoveredSectionId === section.groupId}
                  canControl={isControllerFor(machine.machineId)}
                  onHover={setHoveredSectionId}
                  onSelect={() =>
                    onSelectSection(machine.machineId, section.groupId)
                  }
                  onSelectRow={(terminalId) =>
                    onSelectRow(machine.machineId, section.groupId, terminalId)
                  }
                  onSelectAgentRow={(agentSessionId) =>
                    onSelectAgentRow(machine.machineId, agentSessionId)
                  }
                  onOpenPlusMenu={(x, y) =>
                    setPlusMenu({
                      machineId: machine.machineId,
                      group: section.group,
                      x,
                      y,
                    })
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSectionMenu({
                      machineId: machine.machineId,
                      group: section.group,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onArmDrag={(event) => {
                    if (machine.machineId !== activeMachineId) return;
                    armSectionDrag(section.groupId, event);
                  }}
                  onStartGripDrag={(event) =>
                    startSectionMouseDrag(section.groupId, event)
                  }
                  suppressClickRef={suppressSectionClickRef}
                />
              ))}
            </div>
          );
        })}
        {tree.machines.every((machine) => machine.sections.length === 0) && (
          <div
            style={{
              padding: "12px 8px",
              fontSize: 12,
              color: colors.fg3,
            }}
          >
            No sessions yet
          </div>
        )}
      </div>

      {sectionMenu && (
        <ContextMenu
          x={sectionMenu.x}
          y={sectionMenu.y}
          items={sectionMenuItems}
          onClose={closeSectionMenu}
        />
      )}

      {plusMenu && (
        <ContextMenu
          x={plusMenu.x}
          y={plusMenu.y}
          items={plusMenuItems}
          onClose={closePlusMenu}
        />
      )}

      {/* footer: control lease + settings + sign out */}
      <div
        style={{
          flexShrink: 0,
          height: 48,
          borderTop: `1px solid ${colors.lineSoft}`,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px 0 12px",
        }}
      >
        {viewOnlyLocked ? (
          <button
            type="button"
            data-testid="sidebar-control-pill"
            onClick={onDisengageViewOnly}
            title="Unlock input claims"
            style={controlPillStyle}
          >
            🔒 view only
          </button>
        ) : !isActiveController ? (
          <button
            type="button"
            data-testid="sidebar-control-pill"
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
            data-testid="sidebar-view-only-lock"
            onClick={onEngageViewOnly}
            title="Lock to view only"
            aria-label="Lock to view only"
            style={iconButtonStyle}
          >
            <Lock size={13} />
          </button>
        )}
        <div style={{ flexGrow: 1 }} />
        <button
          type="button"
          data-testid="sidebar-settings"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          style={iconButtonStyle}
        >
          <Settings size={14} />
        </button>
        <button
          type="button"
          data-testid="sidebar-sign-out"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          style={iconButtonStyle}
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

export const Sidebar = memo(SidebarComponent);

/* ---------- section block (header + pane rows) ---------- */

function SidebarSectionBlock({
  section,
  canDrag,
  dragging,
  hovered,
  canControl,
  onHover,
  onSelect,
  onSelectRow,
  onSelectAgentRow,
  onOpenPlusMenu,
  onContextMenu,
  onArmDrag,
  onStartGripDrag,
  suppressClickRef,
}: {
  section: SidebarSection;
  canDrag: boolean;
  dragging: boolean;
  hovered: boolean;
  canControl: boolean;
  onHover: (groupId: string | null) => void;
  onSelect: () => void;
  onSelectRow: (terminalId: string) => void;
  onSelectAgentRow: (agentSessionId: string) => void;
  onOpenPlusMenu: (x: number, y: number) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onArmDrag: (event: ReactMouseEvent<HTMLElement>) => void;
  onStartGripDrag: (event: ReactMouseEvent<HTMLElement>) => void;
  suppressClickRef: { current: boolean };
}) {
  return (
    <div style={{ marginBottom: 2 }}>
      <div
        data-workspace-group-drop-id={section.groupId}
        data-testid={`sidebar-section-${section.groupId}`}
        onMouseEnter={() => onHover(section.groupId)}
        onMouseLeave={() => onHover(null)}
        onMouseDown={(event) => {
          if (!canDrag) return;
          onArmDrag(event);
        }}
        onContextMenu={onContextMenu}
        onClick={() => {
          // Click trailing a completed drag — already handled as a drop.
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onSelect();
        }}
        title={section.cwd ? `${section.label} — ${section.cwd}` : section.label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 6px 0 4px",
          borderRadius: 6,
          cursor: "pointer",
          background: section.active
            ? colors.bg2
            : hovered
              ? colorAlpha.accentSubtle
              : "transparent",
          borderLeft: section.active
            ? `2px solid ${colors.accent}`
            : "2px solid transparent",
          opacity: dragging ? 0.5 : 1,
        }}
      >
        {section.persistent && (
          <span
            role="button"
            tabIndex={-1}
            data-testid={`sidebar-section-drag-${section.groupId}`}
            title="Drag group"
            aria-label={`Drag group ${section.label}`}
            onMouseDown={(event) => {
              if (!canDrag) return;
              onStartGripDrag(event);
            }}
            style={dragHandleStyle}
          >
            <span style={dragGripStyle} />
          </span>
        )}
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: section.active ? colors.fg0 : colors.fg2,
            flexShrink: 0,
            maxWidth: "55%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {section.label}
        </span>
        <span
          style={{
            flexGrow: 1,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: colors.fg3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {section.cwd}
        </span>
        {section.shortcutIndex !== null && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: colors.fg3,
              flexShrink: 0,
              opacity: hovered || section.active ? 1 : 0,
            }}
          >
            ⌃B{section.shortcutIndex}
          </span>
        )}
        <button
          type="button"
          data-testid={`sidebar-section-new-${section.groupId}`}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenPlusMenu(rect.left, rect.bottom + 4);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          disabled={!canControl}
          title="New session here"
          aria-label={`New session in ${section.label}`}
          style={{
            width: 18,
            height: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: 4,
            background: "transparent",
            color: colors.fg2,
            padding: 0,
            flexShrink: 0,
            cursor: canControl ? "pointer" : "not-allowed",
            opacity: hovered ? (canControl ? 1 : 0.4) : 0,
          }}
        >
          <Plus size={11} />
        </button>
      </div>

      {section.rows.map((row) =>
        row.kind === "agent" ? (
          <AgentRow
            key={row.agentSessionId}
            row={row}
            onSelect={() => onSelectAgentRow(row.agentSessionId)}
          />
        ) : (
          <button
            key={row.terminalId}
            type="button"
            data-testid={`sidebar-row-${row.terminalId}`}
            onClick={() => onSelectRow(row.terminalId)}
            title={row.title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              height: 26,
              padding: "0 8px 0 16px",
              border: "none",
              borderRadius: 6,
              background: row.focused ? colors.bg2 : "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <RowDot reachable={row.reachable} />
            <span
              style={{
                flexGrow: 1,
                fontSize: 13,
                fontWeight: row.focused ? 500 : 400,
                color: row.focused
                  ? colors.fg0
                  : row.reachable
                    ? colors.fg1
                    : colors.fg3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {row.title}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

/* ---------- agent session row ---------- */

// Agent rows per Main.dc.html + States.dc.html: 2-letter badge, status dot
// (amber diamond only for asked), unread = bold title + small solid dot.
// `asked` rows get the amber left bar + tint — the only amber in the tree.
function AgentRow({
  row,
  onSelect,
}: {
  row: Extract<SidebarRow, { kind: "agent" }>;
  onSelect: () => void;
}) {
  const asked = row.status === "asked";
  const dimmed = row.status === "disconnected";
  return (
    <button
      type="button"
      data-testid={`sidebar-agent-row-${row.agentSessionId}`}
      onClick={onSelect}
      title={row.title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 30,
        padding: "0 8px 0 6px",
        border: "none",
        borderRadius: 6,
        background: asked
          ? colorAlpha.accentSubtle
          : row.selected
            ? colors.bg2
            : "transparent",
        borderLeft: asked
          ? "2px solid rgb(var(--color-accent) / 0.55)"
          : "2px solid transparent",
        cursor: "pointer",
        textAlign: "left",
        opacity: dimmed ? 0.5 : 1,
        marginBottom: 1,
      }}
    >
      <AgentBadge kind={row.agentKind} />
      <span
        style={{
          flexGrow: 1,
          fontSize: 13,
          fontWeight: row.unread ? 600 : row.selected ? 500 : 400,
          color:
            row.unread || row.selected
              ? colors.fg0
              : dimmed
                ? colors.fg3
                : colors.fg1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {row.title}
      </span>
      {row.unread && (
        <span
          data-testid={`sidebar-agent-row-${row.agentSessionId}-unread`}
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: colors.fg0,
            flexShrink: 0,
          }}
        />
      )}
      <AgentStatusDot status={row.status} />
    </button>
  );
}

/* ---------- inbox banner (asked sessions only) ---------- */

function InboxBanner({
  tree,
  open,
  onToggle,
  onSelectSession,
}: {
  tree: SidebarTree;
  open: boolean;
  onToggle: () => void;
  onSelectSession: (machineId: string, sessionId: string) => void;
}) {
  const machineNameById = new Map(
    tree.machines.map((machine) => [machine.machineId, machine.name]),
  );
  const oldest = tree.askedSessions[0];
  return (
    <div style={{ flexShrink: 0, margin: "8px 8px 2px" }}>
      <button
        type="button"
        data-testid="sidebar-inbox"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          minHeight: 42,
          padding: "4px 8px 4px 10px",
          border: `1px solid ${colorAlpha.accentLine}`,
          borderLeft: `2px solid ${colors.accent}`,
          borderRadius: 6,
          background: colorAlpha.accentSubtle,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <MessageCircle size={14} color={colors.accent} style={{ flexShrink: 0 }} />
        <span style={{ flexGrow: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: colors.accent,
            }}
          >
            {tree.askedSessions.length} waiting on you
          </span>
          <span
            style={{
              display: "block",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.accentDim,
              marginTop: 2,
            }}
          >
            oldest {formatAge(oldest.createdAtMs)}
          </span>
        </span>
        <ChevronDown
          size={11}
          color={colors.accentDim}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>
      {open && (
        <div
          style={{
            marginTop: 4,
            border: `1px solid ${colors.line}`,
            borderRadius: 8,
            background: colors.bg2,
            overflow: "hidden",
          }}
        >
          {tree.askedSessions.map((entry) => {
            const question = getAgentSessionPendingQuestion(entry.sessionId);
            return (
              <button
                key={entry.sessionId}
                type="button"
                data-testid={`sidebar-inbox-item-${entry.sessionId}`}
                onClick={() => onSelectSession(entry.machineId, entry.sessionId)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderBottom: `1px solid ${colors.lineSoft}`,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AgentBadge kind={entry.agentKind} />
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: colors.fg0,
                      flexShrink: 0,
                      maxWidth: "55%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.title}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: colors.fg3,
                      flexGrow: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {machineNameById.get(entry.machineId) ?? ""}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: colors.accentDim,
                      flexShrink: 0,
                    }}
                  >
                    {formatAge(entry.createdAtMs)}
                  </span>
                </span>
                {question && (
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: colors.fg1,
                      marginTop: 6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {question.prompt.split("\n", 1)[0]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact age label: "just now", "4m", "2h", "3d". */
function formatAge(fromMs: number): string {
  const deltaMs = Math.max(0, Date.now() - fromMs);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* ---------- bits ---------- */

function HostDot({ online }: { online: boolean }) {
  return (
    <span
      style={{
        position: "relative",
        width: 10,
        height: 10,
        display: "inline-block",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: online ? colors.ok : colors.fg3,
          boxShadow: `0 0 0 3px ${
            online ? "rgba(99, 209, 143, 0.22)" : "rgba(91, 94, 98, 0.22)"
          }`,
        }}
      />
    </span>
  );
}

// Row status dot: filled green when the terminal is reachable, a dashed
// hollow ring when it is not.
function RowDot({ reachable }: { reachable: boolean }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        flexShrink: 0,
        ...(reachable
          ? { background: colors.ok }
          : { border: `1.4px dashed ${colors.fg3}` }),
      }}
    />
  );
}

/* ---------- cpu/mem/disk micro-meters (extracted from TabBar) ---------- */

function MicroMeters({
  stats,
  testIdPrefix,
}: {
  stats: ResourceStats | undefined;
  testIdPrefix: string;
}) {
  const cpu = stats ? Math.round(stats.cpu_percent) : null;
  const mem =
    stats && stats.memory_total > 0
      ? Math.round((stats.memory_used / stats.memory_total) * 100)
      : null;
  const disk = diskPercent(stats);
  return (
    <span
      data-testid={`${testIdPrefix}-meters`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: colors.fg3,
        marginTop: 5,
        paddingLeft: 17,
      }}
    >
      <Meter label="cpu" percent={cpu} testIdPrefix={testIdPrefix} />
      <Meter label="mem" percent={mem} testIdPrefix={testIdPrefix} />
      <Meter
        label="disk"
        percent={disk}
        title={diskTooltip(stats)}
        testIdPrefix={testIdPrefix}
      />
    </span>
  );
}

function Meter({
  label,
  percent,
  title,
  testIdPrefix,
}: {
  label: string;
  percent: number | null;
  title?: string;
  testIdPrefix: string;
}) {
  return (
    <span
      data-testid={`${testIdPrefix}-meter-${label}`}
      title={title}
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

function Logomark() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colors.accent}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/* ---------- styles ---------- */

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

const iconButtonStyle: CSSProperties = {
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
  flexShrink: 0,
};

const dragHandleStyle: CSSProperties = {
  width: 10,
  height: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "grab",
  flexShrink: 0,
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

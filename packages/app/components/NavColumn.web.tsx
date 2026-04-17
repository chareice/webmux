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
  addDirectoryOpen: boolean;
  onSelectMachine: (id: string) => void;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onAddBookmark: () => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onCancelAddDirectory: () => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onOpenSettings: () => void;
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
    addDirectoryOpen,
    onSelectMachine,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onAddBookmark,
    onConfirmAddDirectory,
    onCancelAddDirectory,
    onRemoveBookmark,
    onOpenSettings,
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
    () =>
      computeWorkpathTags(
        activeMachineBookmarks.map((b) => ({ id: b.id, label: b.label })),
      ),
    [activeMachineBookmarks],
  );

  const rail: RailWorkpath[] = useMemo(
    () => activeMachineBookmarks.map((bm) => ({
      bookmark: bm,
      tag: tags[bm.id] ?? bm.label.slice(0, 2).toLowerCase(),
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
          bookmarks={activeMachineBookmarks}
          selectedWorkpathId={selectedWorkpathId}
          terminalCountsByBookmarkId={counts}
          liveByBookmarkId={live}
          canCreateTerminal={canCreateTerminalForActiveMachine}
          addDirectoryOpen={addDirectoryOpen}
          onSelectAll={onSelectAll}
          onSelectWorkpath={onSelectWorkpath}
          onCreateTerminal={onCreateTerminal}
          onRequestControl={onRequestControl}
          onShowAddDirectory={onAddBookmark}
          onConfirmAddDirectory={onConfirmAddDirectory}
          onCancelAddDirectory={onCancelAddDirectory}
          onRemoveBookmark={onRemoveBookmark}
          onPointerEnter={cancelCollapse}
          onPointerLeave={() => {
            if (!forceExpanded) scheduleCollapse();
          }}
        />
      )}
    </div>
  );
}

export const NavColumn = memo(NavColumnComponent);

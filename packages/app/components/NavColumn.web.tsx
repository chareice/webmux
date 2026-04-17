import { memo, useEffect, useRef, useState, useMemo } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { WorkpathRail, type RailWorkpath } from "./WorkpathRail.web";
import { WorkpathOverlay, type QuickCommand } from "./WorkpathOverlay.web";
import { computeWorkpathTags } from "@/lib/workpathTag";

interface NavColumnProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  bookmarks: Bookmark[];
  terminals: TerminalInfo[];
  selectedWorkpathId: string | "all";
  panelOpen: boolean;
  canCreateTerminalForActiveMachine: boolean;
  addDirectoryOpen: boolean;
  quickCommands: QuickCommand[];
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
  return terminal.machine_id === bm.machine_id && terminal.cwd === bm.path;
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
    addDirectoryOpen,
    quickCommands,
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
    () => bookmarks.filter((b) => b.machine_id === activeMachine?.id),
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

  // Document-level pointer tracking: when the overlay is open, watch the
  // cursor against rail+overlay refs and only collapse when it truly leaves
  // both. We use document pointermove + DOM `contains` (not bounding-box
  // math) so absolutely-positioned overlays still register as "inside" the
  // hover region. Tracking transitions (was-inside → outside) means we
  // schedule collapse exactly once per real exit, instead of resetting the
  // timer on every move — which fixes the Playwright auto-wait edge case
  // that bit the previous onPointerEnter-on-overlay attempt.
  const scheduleCollapse = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setHoverExpanded(false), 400);
  };
  const cancelCollapse = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  // Clear any pending collapse timer on unmount so the deferred
  // setHoverExpanded never fires after the component is gone (React would
  // warn in dev, and the ref state would lie about the timer being null).
  useEffect(
    () => () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = null;
      }
    },
    [],
  );

  // While the user is mid-action (typing in the add-directory PathInput),
  // the overlay must stay open even if the cursor wanders off — otherwise
  // the input unmounts under their hands. Including `addDirectoryOpen` in
  // the expanded derivation keeps it open until the action resolves; on
  // resolution the overlay collapses naturally based on hover state.
  const expanded = hoverExpanded || panelOpen || addDirectoryOpen;

  // Collapse after an explicit overlay action (e.g. choosing a bookmark)
  // unless the user pinned the overlay open with Cmd/Ctrl-B. Add-directory
  // sets addDirectoryOpen which keeps the overlay alive on its own.
  const collapseAfterAction = () => {
    if (panelOpen) return;
    cancelCollapse();
    setHoverExpanded(false);
  };

  useEffect(() => {
    if (!expanded) return;
    // Start at false so the very first pointermove inside rail/overlay
    // registers as a transition-in (cancels any pending rail-leave timer
    // and re-asserts hoverExpanded). Without this the timer scheduled by
    // the rail's onPointerLeave during a fast traversal can fire before
    // the user reaches the overlay.
    const wasInside = { current: false };
    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest) return;
      const inside = !!target.closest(
        '[data-testid="workpath-rail"], [data-testid="workpath-overlay"]',
      );
      if (inside === wasInside.current) return;
      wasInside.current = inside;
      if (inside) {
        cancelCollapse();
        setHoverExpanded(true);
      } else {
        scheduleCollapse();
      }
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, [expanded]);

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
          quickCommands={quickCommands}
          // Wrap navigation actions so the overlay collapses after an
          // explicit choice (selecting a bookmark, opening a quick-cmd
          // terminal, jumping to "All"). Without this the overlay sits
          // over the canvas occluding breadcrumb / overview controls,
          // because Playwright (and a stationary human cursor) never
          // generates a pointermove that would tell our document listener
          // the user has left. Force-expanded and addDirectoryOpen flows
          // are unaffected — they have their own dismissal triggers.
          onSelectAll={() => {
            onSelectAll();
            collapseAfterAction();
          }}
          onSelectWorkpath={(id) => {
            onSelectWorkpath(id);
            collapseAfterAction();
          }}
          onCreateTerminal={(machineId, cwd, startupCommand) => {
            onCreateTerminal(machineId, cwd, startupCommand);
            collapseAfterAction();
          }}
          onRequestControl={onRequestControl}
          onShowAddDirectory={onAddBookmark}
          onConfirmAddDirectory={onConfirmAddDirectory}
          onCancelAddDirectory={onCancelAddDirectory}
          onRemoveBookmark={onRemoveBookmark}
        />
      )}
    </div>
  );
}

export const NavColumn = memo(NavColumnComponent);

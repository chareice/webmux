// packages/app/components/Canvas.web.tsx
import { memo, useRef, useState, useMemo, useCallback, useEffect } from "react";
import type { Bookmark, MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";
import type { TerminalCardRef } from "./TerminalCard.web";
import { OverviewHeader } from "./OverviewHeader.web";
import { TabStrip, type QuickCommand } from "./TabStrip.web";
import { WorkpathEmptyState } from "./WorkpathEmptyState.web";
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
  quickCommands: QuickCommand[];
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
  return t.machine_id === bm.machine_id && t.cwd === bm.path;
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
    quickCommands,
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

  // Four-state machine variables.
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

  // Pane layout state keyed by terminal id (zoomed terminal).
  const [paneLayouts, setPaneLayouts] = useState<Record<string, PaneNode>>({});
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const terminalCardRefs = useRef<Record<string, TerminalCardRef | null>>({});

  // Derive the effective layout synchronously — falls back to a fresh leaf so
  // States 2 and 4 never show a blank frame on the first render after zoom.
  const effectiveLayout: PaneNode | null = useMemo(() => {
    if (!effectiveZoomId) return null;
    return paneLayouts[effectiveZoomId] ?? createLeaf(effectiveZoomId);
  }, [effectiveZoomId, paneLayouts]);

  // Sync the derived leaf into paneLayouts after commit so subsequent
  // split / ratio changes persist correctly.
  useEffect(() => {
    if (!effectiveZoomId) return;
    if (paneLayouts[effectiveZoomId]) return;
    setPaneLayouts((prev) => {
      if (prev[effectiveZoomId]) return prev; // raced with another setter
      return { ...prev, [effectiveZoomId]: createLeaf(effectiveZoomId) };
    });
    setActivePaneId(effectiveZoomId);
  }, [effectiveZoomId, paneLayouts]);

  // Focus the active pane when effectiveZoomId changes.
  useEffect(() => {
    if (!effectiveZoomId) return;
    const targetId = activePaneId || effectiveZoomId;
    const rafId = requestAnimationFrame(() => {
      terminalCardRefs.current[targetId]?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [effectiveZoomId, activePaneId]);

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
      if (!effectiveZoomId || !activePaneId || !activeMachine || !deviceId) return;
      if (!isMachineController(activeMachine.id)) return;
      const activeTerminalForSplit = terminals.find((t) => t.id === activePaneId);
      const cwd = activeTerminalForSplit?.cwd || "~";
      const newTerminal = await createTerminal(activeMachine.id, cwd, deviceId);
      setPaneLayouts((prev) => {
        const current = prev[effectiveZoomId] || createLeaf(effectiveZoomId);
        return {
          ...prev,
          [effectiveZoomId]: splitPane(current, activePaneId, newTerminal.id, direction),
        };
      });
      setActivePaneId(newTerminal.id);
    },
    [effectiveZoomId, activePaneId, activeMachine, deviceId, isMachineController, terminals],
  );

  const handleUpdateRatio = useCallback(
    (splitNode: PaneSplit, newRatio: number) => {
      if (!effectiveZoomId) return;
      setPaneLayouts((prev) => {
        const current = prev[effectiveZoomId];
        if (!current) return prev;
        return { ...prev, [effectiveZoomId]: updateRatio(current, splitNode, newRatio) };
      });
    },
    [effectiveZoomId],
  );

  const handleActivatePane = useCallback((id: string) => {
    setActivePaneId(id);
  }, []);

  const handleFocusPrevPane = useCallback(() => {
    if (!effectiveZoomId) return;
    const layout = paneLayouts[effectiveZoomId];
    if (!layout) return;
    const leaves = getLeaves(layout);
    const idx = leaves.findIndex((l) => l.terminalId === activePaneId);
    const prevIdx = (idx - 1 + leaves.length) % leaves.length;
    setActivePaneId(leaves[prevIdx].terminalId);
    terminalCardRefs.current[leaves[prevIdx].terminalId]?.focus();
  }, [effectiveZoomId, paneLayouts, activePaneId]);

  const handleFocusNextPane = useCallback(() => {
    if (!effectiveZoomId) return;
    const layout = paneLayouts[effectiveZoomId];
    if (!layout) return;
    const leaves = getLeaves(layout);
    const idx = leaves.findIndex((l) => l.terminalId === activePaneId);
    const nextIdx = (idx + 1) % leaves.length;
    setActivePaneId(leaves[nextIdx].terminalId);
    terminalCardRefs.current[leaves[nextIdx].terminalId]?.focus();
  }, [effectiveZoomId, paneLayouts, activePaneId]);

  const closePaneById = useCallback(
    (terminalId: string) => {
      if (!effectiveZoomId) return;
      const terminal = terminals.find((t) => t.id === terminalId);
      if (!terminal) return;
      const layout = paneLayouts[effectiveZoomId];
      if (terminalId === effectiveZoomId && layout && layout.type === "split") {
        const remaining = removePane(layout, terminalId);
        if (remaining) {
          const newRoot = getLeaves(remaining)[0]?.terminalId;
          if (newRoot) {
            setPaneLayouts((prev) => {
              const copy = { ...prev };
              delete copy[effectiveZoomId];
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
    [effectiveZoomId, paneLayouts, terminals, onDestroy, onZoomTerminal],
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

  // Track which terminals are mounted *visibly* — either the leaves of
  // the zoomed pane layout, or every visible card in the overview grid.
  // The hidden-mount loop below skips these so we don't double-mount
  // (and double-attach a tmux client per terminal) when the user is in
  // overview mode and every terminal already has a visible card.
  const renderedIds = useMemo(() => {
    const s = new Set<string>();
    if (effectiveZoomId && effectiveLayout) {
      for (const leaf of getLeaves(effectiveLayout)) s.add(leaf.terminalId);
    } else {
      // Overview mode: every card in `scopedTerminals` is visible.
      for (const t of scopedTerminals) s.add(t.id);
    }
    return s;
  }, [effectiveZoomId, paneLayouts, scopedTerminals]);

  // Workpath label resolver for All-grid cards.
  const workpathLabelByMachineAndCwd = useMemo(() => {
    const map = new Map<string, string>();
    for (const bm of bookmarks) {
      map.set(`${bm.machine_id}::${bm.path}`, bm.label);
    }
    return map;
  }, [bookmarks]);

  const labelForTerminal = useCallback((t: TerminalInfo): string | undefined => {
    return workpathLabelByMachineAndCwd.get(`${t.machine_id}::${t.cwd}`);
  }, [workpathLabelByMachineAndCwd]);

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
      {/* State 1: All scope + no zoom → All grid */}
      {isAll && !zoomedTerminalId && (
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
                  workpathLabel={(() => {
                    const wp = labelForTerminal(terminal);
                    if (!wp) return undefined;
                    return `${wp} · ${terminal.title || ""}`;
                  })()}
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

      {/* State 2: All scope + zoom → immersive terminal (no tab strip) */}
      {isAll && zoomedTerminalId && effectiveLayout && (
        <div
          style={{ flex: 1, overflow: "hidden", display: "flex" }}
          onContextMenu={(e) => handleTerminalContextMenu(e, activePaneId || zoomedTerminalId)}
        >
          <SplitPaneContainer
            node={effectiveLayout}
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

      {/* State 3: workpath + no terminals → WorkpathEmptyState */}
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
          }}
        />
      )}

      {/* State 4: workpath + has terminals → TabStrip + immersive of effective tab */}
      {inWorkpath && workpathHasTerminals && effectiveZoomId && effectiveLayout && (
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
              node={effectiveLayout}
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

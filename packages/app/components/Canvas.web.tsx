import { memo, useRef, useState, useMemo, useCallback, useEffect } from "react";
import type { MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";
import type { TerminalCardRef } from "./TerminalCard.web";
import { colors, colorAlpha } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";
import { TitleBar } from "./TitleBar";
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
  activeTabId: string | null;
  activeMachineId: string | null;
  machineStats: Record<string, ResourceStats>;
  isMobile: boolean;
  isActiveController: boolean;
  isMachineController: (machineId: string) => boolean;
  deviceId: string;
  onSelectTab: (id: string | null) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
  onNewTerminal?: () => void;
  splitPaneRef?: React.MutableRefObject<{
    splitVertical: () => void;
    splitHorizontal: () => void;
    focusPrevPane: () => void;
    focusNextPane: () => void;
  } | null>;
}


function CanvasComponent({
  machines,
  terminals,
  activeTabId,
  activeMachineId,
  machineStats,
  isMobile,
  isActiveController,
  isMachineController,
  deviceId,
  onSelectTab,
  onDestroy,
  onRequestControl,
  onReleaseControl,
  onNewTerminal,
  splitPaneRef,
}: CanvasProps) {
  // Local tab display order
  const [tabOrder, setTabOrder] = useState<string[]>([]);

  // Pane layout state: maps tab id -> pane tree
  const [paneLayouts, setPaneLayouts] = useState<Record<string, PaneNode>>({});
  const [activePaneId, setActivePaneId] = useState<string | null>(null);

  // Reconcile tabOrder when terminals change
  const orderedTerminals = useMemo(() => {
    const terminalIds = new Set(terminals.map((t) => t.id));
    const kept = tabOrder.filter((id) => terminalIds.has(id));
    const keptSet = new Set(kept);
    const added = terminals.filter((t) => !keptSet.has(t.id)).map((t) => t.id);
    const finalOrder = [...kept, ...added];
    if (finalOrder.join(",") !== tabOrder.join(",")) {
      setTabOrder(finalOrder);
    }
    return finalOrder.map((id) => terminals.find((t) => t.id === id)!).filter(Boolean);
  }, [terminals, tabOrder]);

  const handleReorderTabs = useCallback((newOrder: string[]) => {
    setTabOrder(newOrder);
  }, []);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null);

  const handleTerminalContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, terminalId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const activeMachine = activeMachineId
    ? machines.find((machine) => machine.id === activeMachineId) ?? null
    : machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;
  const controlCopy = getTerminalControlCopy(isActiveController);
  const terminalCardRefs = useRef<Record<string, TerminalCardRef | null>>({});

  const activeTerminal = activeTabId
    ? terminals.find((t) => t.id === activeTabId) ?? null
    : null;

  // If activeTabId points to a terminal that no longer exists, fall back to grid
  const effectiveTabId = activeTerminal ? activeTabId : null;

  // Initialize pane layout for newly selected tab
  useEffect(() => {
    if (effectiveTabId && !paneLayouts[effectiveTabId]) {
      setPaneLayouts((prev) => ({
        ...prev,
        [effectiveTabId]: createLeaf(effectiveTabId),
      }));
      setActivePaneId(effectiveTabId);
    }
  }, [effectiveTabId, paneLayouts]);

  // Clean up pane tree when terminals are destroyed
  useEffect(() => {
    const terminalIds = new Set(terminals.map((t) => t.id));
    setPaneLayouts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [tabId, layout] of Object.entries(next)) {
        let current: PaneNode | null = layout;
        const leaves = getLeaves(layout);
        for (const leaf of leaves) {
          if (!terminalIds.has(leaf.terminalId) && current) {
            current = removePane(current, leaf.terminalId);
            changed = true;
          }
        }
        if (current) {
          next[tabId] = current;
        } else {
          delete next[tabId];
        }
      }
      return changed ? next : prev;
    });
  }, [terminals]);

  // Split pane handlers
  const handleSplitPane = useCallback(
    async (direction: "horizontal" | "vertical") => {
      if (!effectiveTabId || !activePaneId || !activeMachine || !deviceId) return;
      if (!isMachineController(activeMachine.id)) return;

      const activeTerminalForSplit = terminals.find((t) => t.id === activePaneId);
      const cwd = activeTerminalForSplit?.cwd || "~";
      const newTerminal = await createTerminal(activeMachine.id, cwd, deviceId);

      setPaneLayouts((prev) => {
        const current = prev[effectiveTabId] || createLeaf(effectiveTabId);
        return {
          ...prev,
          [effectiveTabId]: splitPane(current, activePaneId, newTerminal.id, direction),
        };
      });
      setActivePaneId(newTerminal.id);
    },
    [effectiveTabId, activePaneId, activeMachine, deviceId, isMachineController, terminals],
  );

  const handleUpdateRatio = useCallback(
    (splitNode: PaneSplit, newRatio: number) => {
      if (!effectiveTabId) return;
      setPaneLayouts((prev) => {
        const current = prev[effectiveTabId];
        if (!current) return prev;
        return { ...prev, [effectiveTabId]: updateRatio(current, splitNode, newRatio) };
      });
    },
    [effectiveTabId],
  );

  const handleActivatePane = useCallback((terminalId: string) => {
    setActivePaneId(terminalId);
  }, []);

  const handleFocusPrevPane = useCallback(() => {
    if (!effectiveTabId) return;
    const layout = paneLayouts[effectiveTabId];
    if (!layout) return;
    const leaves = getLeaves(layout);
    const idx = leaves.findIndex((l) => l.terminalId === activePaneId);
    const prevIdx = (idx - 1 + leaves.length) % leaves.length;
    setActivePaneId(leaves[prevIdx].terminalId);
    terminalCardRefs.current[leaves[prevIdx].terminalId]?.focus();
  }, [effectiveTabId, paneLayouts, activePaneId]);

  const handleFocusNextPane = useCallback(() => {
    if (!effectiveTabId) return;
    const layout = paneLayouts[effectiveTabId];
    if (!layout) return;
    const leaves = getLeaves(layout);
    const idx = leaves.findIndex((l) => l.terminalId === activePaneId);
    const nextIdx = (idx + 1) % leaves.length;
    setActivePaneId(leaves[nextIdx].terminalId);
    terminalCardRefs.current[leaves[nextIdx].terminalId]?.focus();
  }, [effectiveTabId, paneLayouts, activePaneId]);

  // Expose split pane handlers via ref for TerminalCanvas to wire shortcuts
  useEffect(() => {
    if (splitPaneRef) {
      splitPaneRef.current = {
        splitVertical: () => handleSplitPane("vertical"),
        splitHorizontal: () => handleSplitPane("horizontal"),
        focusPrevPane: handleFocusPrevPane,
        focusNextPane: handleFocusNextPane,
      };
    }
    return () => {
      if (splitPaneRef) {
        splitPaneRef.current = null;
      }
    };
  }, [splitPaneRef, handleSplitPane, handleFocusPrevPane, handleFocusNextPane]);

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
      {/* Title bar with integrated tabs */}
      <TitleBar
        terminals={orderedTerminals}
        activeTabId={effectiveTabId}
        isMobile={isMobile}
        onSelectTab={onSelectTab}
        onCloseTab={onDestroy}
        onNewTerminal={onNewTerminal}
        onReorderTabs={handleReorderTabs}
      />

      {/* Content area */}

      {/* Active tab with split pane layout */}
      {effectiveTabId && paneLayouts[effectiveTabId] && (
        <div
          style={{ flex: 1, overflow: "hidden", display: "flex" }}
          onContextMenu={(e) => handleTerminalContextMenu(e, activePaneId || effectiveTabId)}
        >
          <SplitPaneContainer
            node={paneLayouts[effectiveTabId]}
            terminals={terminals}
            activePaneId={activePaneId}
            isMobile={isMobile}
            isMachineController={isMachineController}
            deviceId={deviceId}
            terminalCardRefs={terminalCardRefs}
            onSelectTab={onSelectTab}
            onDestroy={onDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
            onActivatePane={handleActivatePane}
            onUpdateRatio={handleUpdateRatio}
          />
        </div>
      )}

      {/* Hidden terminals: keep non-active tabs' terminals mounted to preserve state */}
      {orderedTerminals
        .filter((terminal) => {
          // Skip terminals rendered by the active pane layout
          if (effectiveTabId && paneLayouts[effectiveTabId]) {
            const activeLeaves = getLeaves(paneLayouts[effectiveTabId]);
            if (activeLeaves.some((l) => l.terminalId === terminal.id)) return false;
          }
          // Only render hidden terminals that aren't in ANY active pane layout display
          return true;
        })
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
              onSelectTab={onSelectTab}
              onDestroy={onDestroy}
              onRequestControl={onRequestControl}
              onReleaseControl={onReleaseControl}
            />
          </div>
        ))}

      {/* Grid overview — only rendered when no tab is active */}
      {!effectiveTabId && (
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: isMobile ? 12 : 20,
          paddingTop: isMobile ? 52 : 20,
        }}
      >
        {activeMachine && (
          <section
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
              background:
                `linear-gradient(135deg, ${colorAlpha.surfaceOpaque94} 0%, ${colorAlpha.backgroundOpaque98} 100%)`,
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
                Active Machine
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    fontSize: isMobile ? 18 : 20,
                    fontWeight: 700,
                    color: colors.foreground,
                  }}
                >
                  {activeMachine.name}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: isActiveController
                      ? colorAlpha.accentLight12
                      : colorAlpha.warningLight12,
                    border: isActiveController
                      ? `1px solid ${colorAlpha.accentBorder}`
                      : `1px solid ${colorAlpha.warningBorder22}`,
                    color: isActiveController
                      ? colors.accent
                      : colors.warning,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: isActiveController
                        ? colors.accent
                        : colors.warning,
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
              {activeStats && (
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
                  <span>CPU {Math.round(activeStats.cpu_percent)}%</span>
                  <span>
                    MEM {Math.round((activeStats.memory_used / Math.max(activeStats.memory_total, 1)) * 100)}%
                  </span>
                  <span>{terminals.filter((terminal) => terminal.machine_id === activeMachine.id).length} terminals</span>
                </div>
              )}
              {onRequestControl && onReleaseControl && (
                <button
                  data-testid="canvas-mode-toggle"
                  onClick={() => {
                    if (isActiveController) {
                      onReleaseControl(activeMachine.id);
                      return;
                    }
                    onRequestControl(activeMachine.id);
                  }}
                  style={{
                    background: isActiveController
                      ? "transparent"
                      : colors.accent,
                    border: isActiveController
                      ? `1px solid ${colors.border}`
                      : "none",
                    borderRadius: 999,
                    color: isActiveController
                      ? colors.foreground
                      : colors.background,
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
        )}

        {terminals.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: colors.foregroundMuted,
              fontSize: 14,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 48,
                  marginBottom: 16,
                  opacity: 0.3,
                }}
              >
                &#x2B21;
              </div>
              <div>
                {isMobile
                  ? "Tap \u2630 to open a terminal"
                  : "Select a directory to open a terminal"}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fill, minmax(320px, 1fr))",
              gap: isMobile ? 12 : 16,
              alignContent: "start",
            }}
          >
            {terminals.map((terminal) => (
              <TerminalCard
                key={terminal.id}
                terminal={terminal}
                displayMode="card"
                isMobile={isMobile}
                isController={isMachineController(terminal.machine_id)}
                deviceId={deviceId}
                onSelectTab={onSelectTab}
                onDestroy={onDestroy}
                onRequestControl={onRequestControl}
                onReleaseControl={onReleaseControl}
              />
            ))}
          </div>
        )}
      </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          items={[
            {
              label: "Copy",
              shortcut: "Ctrl+C",
              onClick: () => {
                document.execCommand("copy");
              },
            },
            {
              label: "Paste",
              shortcut: "Ctrl+V",
              onClick: () => {
                const ref = terminalCardRefs.current[contextMenu.terminalId];
                ref?.focus();
              },
            },
            { type: "separator" as const },
            {
              label: "Split Vertically",
              shortcut: "Ctrl+\\",
              onClick: () => {
                handleSplitPane("vertical");
              },
            },
            {
              label: "Split Horizontally",
              shortcut: "Ctrl+Shift+\\",
              onClick: () => {
                handleSplitPane("horizontal");
              },
            },
            { type: "separator" as const },
            {
              label: "Clear Screen",
              onClick: () => {
                const ref = terminalCardRefs.current[contextMenu.terminalId];
                ref?.sendInput("\x0c");
              },
            },
          ] as ContextMenuEntry[]}
        />
      )}
    </main>
  );
}

export const Canvas = memo(CanvasComponent);

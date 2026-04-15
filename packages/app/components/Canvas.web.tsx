import { memo } from "react";
import type { MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";
import { LayoutGrid, X } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

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
}

function TabBar({
  terminals,
  activeTabId,
  isMobile,
  onSelectTab,
  onCloseTab,
}: {
  terminals: TerminalInfo[];
  activeTabId: string | null;
  isMobile: boolean;
  onSelectTab: (id: string | null) => void;
  onCloseTab: (terminal: TerminalInfo) => void;
}) {
  if (terminals.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        overflowX: "auto",
        overflowY: "hidden",
        flexShrink: 0,
        minHeight: isMobile ? 40 : 36,
      }}
    >
      {/* All tab */}
      <button
        data-testid="tab-all"
        onClick={() => onSelectTab(null)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: isMobile ? "8px 14px" : "6px 14px",
          background: activeTabId === null ? colors.background : "transparent",
          border: "none",
          borderBottom: activeTabId === null
            ? `2px solid ${colors.accent}`
            : "2px solid transparent",
          color: activeTabId === null ? colors.foreground : colors.foregroundSecondary,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: activeTabId === null ? 600 : 400,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <LayoutGrid size={14} />
        All
      </button>

      {/* Terminal tabs */}
      {terminals.map((terminal) => {
        const isActive = activeTabId === terminal.id;
        return (
          <div
            key={terminal.id}
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: isActive
                ? `2px solid ${colors.accent}`
                : "2px solid transparent",
              background: isActive ? colors.background : "transparent",
              flexShrink: 0,
              maxWidth: 200,
            }}
          >
            <button
              data-testid={`tab-${terminal.id}`}
              onClick={() => onSelectTab(terminal.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: isMobile ? "8px 8px 8px 14px" : "6px 6px 6px 14px",
                background: "none",
                border: "none",
                color: isActive ? colors.foreground : colors.foregroundSecondary,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: colors.accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {terminal.title}
              </span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(terminal);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                padding: isMobile ? "8px 8px" : "4px 6px",
                background: "none",
                border: "none",
                color: colors.foregroundMuted,
                cursor: "pointer",
                opacity: 0.5,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.color = colors.danger;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "0.5";
                e.currentTarget.style.color = colors.foregroundMuted;
              }}
              title="Close terminal"
              aria-label="Close terminal"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
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
}: CanvasProps) {
  const activeMachine = activeMachineId
    ? machines.find((machine) => machine.id === activeMachineId) ?? null
    : machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;
  const controlCopy = getTerminalControlCopy(isActiveController);

  const activeTerminal = activeTabId
    ? terminals.find((t) => t.id === activeTabId) ?? null
    : null;

  // If activeTabId points to a terminal that no longer exists, fall back to grid
  const effectiveTabId = activeTerminal ? activeTabId : null;

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
      {/* Tab bar */}
      <TabBar
        terminals={terminals}
        activeTabId={effectiveTabId}
        isMobile={isMobile}
        onSelectTab={onSelectTab}
        onCloseTab={onDestroy}
      />

      {/* Content area — all terminals stay mounted to preserve state (mouse tracking, scrollback) */}

      {/* Tab views — each terminal always mounted, hidden when not active */}
      {terminals.map((terminal) => (
        <div
          key={terminal.id}
          style={
            effectiveTabId === terminal.id
              ? { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }
              : { display: "none" }
          }
        >
          <TerminalCard
            terminal={terminal}
            displayMode="tab"
            isMobile={isMobile}
            isController={isMachineController(terminal.machine_id)}
            deviceId={deviceId}
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
    </main>
  );
}

export const Canvas = memo(CanvasComponent);

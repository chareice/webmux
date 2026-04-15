import { memo } from "react";
import type { MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";
import { colors, colorAlpha } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

interface CanvasProps {
  machines: MachineInfo[];
  terminals: TerminalInfo[];
  maximizedId: string | null;
  activeMachineId: string | null;
  machineStats: Record<string, ResourceStats>;
  isMobile: boolean;
  isActiveController: boolean;
  isMachineController: (machineId: string) => boolean;
  deviceId: string;
  onMaximize: (id: string) => void;
  onMinimize: () => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

function CanvasComponent({
  machines,
  terminals,
  maximizedId,
  activeMachineId,
  machineStats,
  isMobile,
  isActiveController,
  isMachineController,
  deviceId,
  onMaximize,
  onMinimize,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}: CanvasProps) {
  const activeMachine = activeMachineId
    ? machines.find((machine) => machine.id === activeMachineId) ?? null
    : machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;
  const controlCopy = getTerminalControlCopy(isActiveController);

  return (
    <main
      style={{
        flex: 1,
        overflow: "auto",
        padding: isMobile ? 12 : 20,
        paddingTop: isMobile ? 52 : 20,
        background: colors.background,
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
              maximized={maximizedId === terminal.id}
              isMobile={isMobile}
              isController={isMachineController(terminal.machine_id)}
              deviceId={deviceId}
              onMaximize={onMaximize}
              onMinimize={onMinimize}
              onDestroy={onDestroy}
              onRequestControl={onRequestControl}
              onReleaseControl={onReleaseControl}
            />
          ))}
        </div>
      )}
    </main>
  );
}

export const Canvas = memo(CanvasComponent);

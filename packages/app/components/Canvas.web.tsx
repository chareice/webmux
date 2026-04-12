import { memo } from "react";
import type { MachineInfo, ResourceStats, TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";

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

  return (
    <main
      style={{
        flex: 1,
        overflow: "auto",
        padding: isMobile ? 12 : 20,
        paddingTop: isMobile ? 52 : 20,
        background: "rgb(10, 25, 41)",
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
            border: "1px solid rgb(26, 58, 92)",
            background:
              "linear-gradient(135deg, rgba(17, 42, 69, 0.94) 0%, rgba(10, 25, 41, 0.98) 100%)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "rgb(74, 97, 120)",
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
                  color: "rgb(224, 232, 240)",
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
                    ? "rgba(0, 212, 170, 0.12)"
                    : "rgba(255, 193, 7, 0.12)",
                  border: isActiveController
                    ? "1px solid rgba(0, 212, 170, 0.25)"
                    : "1px solid rgba(255, 193, 7, 0.22)",
                  color: isActiveController
                    ? "rgb(0, 212, 170)"
                    : "rgb(255, 193, 7)",
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
                      ? "rgb(0, 212, 170)"
                      : "rgb(255, 193, 7)",
                  }}
                />
                {isActiveController ? "Control Mode" : "Watch Mode"}
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
                  color: "rgb(122, 143, 166)",
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
                    : "rgb(0, 212, 170)",
                  border: isActiveController
                    ? "1px solid rgb(26, 58, 92)"
                    : "none",
                  borderRadius: 999,
                  color: isActiveController
                    ? "rgb(224, 232, 240)"
                    : "rgb(10, 25, 41)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "10px 16px",
                }}
              >
                {isActiveController ? "Release Control" : "Take Control"}
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
            color: "rgb(74, 97, 120)",
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

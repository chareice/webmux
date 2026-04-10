import type { TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";

interface CanvasProps {
  terminals: TerminalInfo[];
  maximizedId: string | null;
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  onMaximize: (id: string) => void;
  onMinimize: () => void;
  onDestroy: (terminal: TerminalInfo) => void;
}

export function Canvas({
  terminals,
  maximizedId,
  isMobile,
  isController,
  deviceId,
  onMaximize,
  onMinimize,
  onDestroy,
}: CanvasProps) {
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
              isController={isController}
              deviceId={deviceId}
              onMaximize={() => onMaximize(terminal.id)}
              onMinimize={onMinimize}
              onDestroy={() => onDestroy(terminal)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

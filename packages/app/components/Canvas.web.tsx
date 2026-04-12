import type { TerminalInfo } from "@webmux/shared";
import { TerminalCard } from "./TerminalCard.web";

interface CanvasProps {
  terminals: TerminalInfo[];
  openTabs: string[];
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  onOpen: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
}

export function Canvas({
  terminals,
  openTabs,
  isMobile,
  isController,
  deviceId,
  onOpen,
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
              isInTab={openTabs.includes(terminal.id)}
              isMobile={isMobile}
              isController={isController}
              deviceId={deviceId}
              onOpen={() => onOpen(terminal.id)}
              onDestroy={() => onDestroy(terminal)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

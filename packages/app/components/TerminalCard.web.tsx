import { useRef } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Maximize2, X } from "lucide-react";
import { TerminalView } from "./TerminalView.web";
import type { TerminalViewRef } from "./TerminalView.types";
import { terminalWsUrl } from "@/lib/api";

interface TerminalCardProps {
  terminal: TerminalInfo;
  isInTab: boolean;
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  onOpen: () => void;
  onDestroy: () => void;
}

export function TerminalCard({
  terminal,
  isInTab,
  isMobile,
  isController,
  deviceId,
  onOpen,
  onDestroy,
}: TerminalCardProps) {
  const termViewRef = useRef<TerminalViewRef>(null);
  const wsUrl = terminalWsUrl(terminal.machine_id, terminal.id, deviceId);

  return (
    <div
      style={{
        background: "rgb(17, 42, 69)",
        borderRadius: 8,
        border: "1px solid rgb(26, 58, 92)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.2s",
        opacity: isInTab ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "rgb(0, 212, 170)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgb(26, 58, 92)";
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          borderBottom: "1px solid rgb(26, 58, 92)",
          background: "rgba(0,0,0,0.2)",
          cursor: "pointer",
        }}
        onClick={onOpen}
      >
        {/* Left: close button */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isController) return;
              onDestroy();
            }}
            style={{
              background: "none",
              border: "none",
              color: isController
                ? "rgb(255, 107, 107)"
                : "rgb(74, 97, 120)",
              cursor: isController ? "pointer" : "not-allowed",
              padding: isMobile ? "10px 12px" : "2px 4px",
              display: "flex",
              alignItems: "center",
              opacity: isController ? 0.6 : 0.3,
            }}
            onMouseEnter={(e) => {
              if (isController) e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = isController ? "0.6" : "0.3";
            }}
            title={
              isController ? "Close terminal" : "Watch mode - cannot close"
            }
            aria-label={
              isController ? "Close terminal" : "Watch mode - cannot close"
            }
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Center: title + status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            overflow: "hidden",
            minWidth: 0,
            flex: 1,
            marginLeft: 4,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "rgb(0, 212, 170)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: "rgb(224, 232, 240)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {terminal.title}
          </span>
          {isInTab && (
            <span
              style={{
                fontSize: 9,
                color: "rgb(0, 212, 170)",
                background: "rgba(0, 212, 170, 0.1)",
                border: "1px solid rgba(0, 212, 170, 0.3)",
                borderRadius: 3,
                padding: "0px 5px",
                flexShrink: 0,
              }}
            >
              In Tab
            </span>
          )}
        </div>

        {/* Right: open button */}
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            style={{
              background: "none",
              border: "none",
              color: "rgb(122, 143, 166)",
              cursor: "pointer",
              padding: isMobile ? "10px 12px" : "2px 4px",
              display: "flex",
              alignItems: "center",
            }}
            title="Open in tab"
            aria-label="Open in tab"
          >
            <Maximize2 size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/* Terminal preview — skip if already open in tab to avoid duplicate WS */}
      <div
        style={{
          aspectRatio: "5 / 3",
          overflow: "hidden",
          cursor: "pointer",
          position: "relative",
        }}
        onClick={onOpen}
      >
        {isInTab ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgb(74, 97, 120)",
              fontSize: 12,
            }}
          >
            Open in tab view
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              pointerEvents: "none" as const,
              overflow: "hidden",
            }}
          >
            <div style={{ width: "100%", height: "100%" }}>
              <TerminalView
                ref={termViewRef}
                machineId={terminal.machine_id}
                terminalId={terminal.id}
                wsUrl={wsUrl}
                isController={isController}
                style={{
                  transform: "scale(0.35)",
                  transformOrigin: "top left",
                  width: "286%",
                  height: "286%",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "2px 8px",
          borderTop: "1px solid rgb(26, 58, 92)",
          fontSize: 9,
          color: "rgb(74, 97, 120)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {terminal.cwd}
      </div>
    </div>
  );
}

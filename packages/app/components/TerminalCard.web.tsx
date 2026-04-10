import { useRef, useCallback } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { TerminalView } from "./TerminalView.web";
import type { TerminalViewRef } from "./TerminalView.types";
import { TerminalToolbar } from "./TerminalToolbar";
import { CommandBar } from "./CommandBar";
import { terminalWsUrl } from "@/lib/api";

interface TerminalCardProps {
  terminal: TerminalInfo;
  maximized: boolean;
  isMobile: boolean;
  onMaximize: () => void;
  onMinimize: () => void;
  onDestroy: () => void;
}

export function TerminalCard({
  terminal,
  maximized,
  isMobile,
  onMaximize,
  onMinimize,
  onDestroy,
}: TerminalCardProps) {
  const termViewRef = useRef<TerminalViewRef>(null);

  const handleToolbarKey = useCallback((data: string) => {
    termViewRef.current?.sendInput(data);
    termViewRef.current?.focus();
  }, []);

  const handleImagePaste = useCallback((base64: string, mime: string) => {
    termViewRef.current?.sendImagePaste(base64, mime);
  }, []);

  const handleTitleClick = useCallback(() => {
    if (!maximized) onMaximize();
  }, [maximized, onMaximize]);

  const wsUrl = terminalWsUrl(terminal.machine_id, terminal.id);

  return (
    <>
      {/* Backdrop overlay when maximized */}
      {maximized && (
        <div
          onClick={onMinimize}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
          }}
        />
      )}

      <div
        style={
          maximized
            ? {
                position: "fixed",
                top: isMobile ? 0 : "5vh",
                left: isMobile ? 0 : "5vw",
                width: isMobile ? "100vw" : "90vw",
                height: isMobile ? "100vh" : "90vh",
                zIndex: 100,
                background: "rgb(17, 42, 69)",
                borderRadius: isMobile ? 0 : 8,
                border: isMobile
                  ? "none"
                  : "2px solid rgb(0, 212, 170)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }
            : {
                background: "rgb(17, 42, 69)",
                borderRadius: 8,
                border: "1px solid rgb(26, 58, 92)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "border-color 0.2s",
              }
        }
        onMouseEnter={(e) => {
          if (!maximized)
            e.currentTarget.style.borderColor = "rgb(0, 212, 170)";
        }}
        onMouseLeave={(e) => {
          if (!maximized)
            e.currentTarget.style.borderColor = "rgb(26, 58, 92)";
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: maximized ? "8px 12px" : "4px 8px",
            borderBottom: "1px solid rgb(26, 58, 92)",
            background: "rgba(0,0,0,0.2)",
            cursor: maximized ? "default" : "pointer",
          }}
          onClick={handleTitleClick}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              overflow: "hidden",
              minWidth: 0,
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
                fontSize: maximized ? 13 : 11,
                color: "rgb(224, 232, 240)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {terminal.title}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {!maximized && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMaximize();
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgb(122, 143, 166)",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "0 4px",
                }}
                title="Maximize"
              >
                &#x2922;
              </button>
            )}
            {maximized && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMinimize();
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgb(122, 143, 166)",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "0 4px",
                }}
                title="Minimize"
              >
                &#x2921;
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDestroy();
              }}
              style={{
                background: "none",
                border: "none",
                color: "rgb(255, 107, 107)",
                cursor: "pointer",
                fontSize: 12,
                padding: "0 4px",
                opacity: 0.6,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.opacity = "1")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.opacity = "0.6")
              }
              title="Close terminal"
            >
              &#x2715;
            </button>
          </div>
        </div>

        {/* Terminal content + side panel */}
        {maximized ? (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div
              style={{
                flex: 1,
                padding: "8px 10px",
                overflow: "hidden",
              }}
            >
              <TerminalView
                ref={termViewRef}
                machineId={terminal.machine_id}
                terminalId={terminal.id}
                wsUrl={wsUrl}
              />
            </div>
            {!isMobile && (
              <CommandBar
                onSend={handleToolbarKey}
                onImagePaste={handleImagePaste}
              />
            )}
          </div>
        ) : (
          <div
            style={{
              aspectRatio: "5 / 3",
              overflow: "hidden",
              cursor: "pointer",
              position: "relative",
            }}
            onClick={onMaximize}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              <TerminalView
                ref={termViewRef}
                machineId={terminal.machine_id}
                terminalId={terminal.id}
                wsUrl={wsUrl}
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

        {/* Mobile toolbar */}
        {maximized && isMobile && (
          <TerminalToolbar onKey={handleToolbarKey} />
        )}

        {/* Footer */}
        <div
          style={{
            padding: maximized ? "4px 12px" : "2px 8px",
            borderTop: "1px solid rgb(26, 58, 92)",
            fontSize: maximized ? 11 : 9,
            color: "rgb(74, 97, 120)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {terminal.cwd}
        </div>
      </div>
    </>
  );
}

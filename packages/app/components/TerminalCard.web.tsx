import { useRef, useCallback, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Maximize2, Minimize2, X } from "lucide-react";
import { TerminalView } from "./TerminalView.web";
import type { TerminalViewRef } from "./TerminalView.types";
import { ExtendedKeyBar } from "./ExtendedKeyBar";
import { CommandBar } from "./CommandBar";
import { terminalWsUrl } from "@/lib/api";

interface TerminalCardProps {
  terminal: TerminalInfo;
  maximized: boolean;
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  onMaximize: () => void;
  onMinimize: () => void;
  onDestroy: () => void;
  onRequestControl?: () => void;
  onReleaseControl?: () => void;
}

export function TerminalCard({
  terminal,
  maximized,
  isMobile,
  isController,
  deviceId,
  onMaximize,
  onMinimize,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}: TerminalCardProps) {
  const termViewRef = useRef<TerminalViewRef>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [commandBarVisible, setCommandBarVisible] = useState(false);

  const handleToolbarKey = useCallback((data: string) => {
    termViewRef.current?.sendCommandInput(data);
    if (isController) termViewRef.current?.focus();
  }, [isController]);

  const handleImagePaste = useCallback((base64: string, mime: string) => {
    termViewRef.current?.sendImagePaste(base64, mime);
  }, []);

  const handleTitleClick = useCallback(() => {
    if (!maximized) onMaximize();
  }, [maximized, onMaximize]);

  const wsUrl = terminalWsUrl(terminal.machine_id, terminal.id, deviceId);

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
                height: isMobile ? "100dvh" : "90vh",
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
            {/* Watch mode badge */}
            {maximized && !isController && (
              <span style={{
                fontSize: 10,
                color: 'rgb(122, 143, 166)',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgb(26, 58, 92)',
                borderRadius: 4,
                padding: '1px 6px',
                marginLeft: 4,
                flexShrink: 0,
              }}>
                Watch Mode
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            {/* Inline mode controls for mobile maximized — flat style, no container */}
            {maximized && isMobile && onRequestControl && onReleaseControl && (
              <>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: isController ? 'rgb(0, 212, 170)' : 'rgb(74, 97, 120)',
                  flexShrink: 0,
                }} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isController) onReleaseControl();
                    else onRequestControl();
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: isController ? 'rgb(122, 143, 166)' : 'rgb(0, 212, 170)',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '2px 4px',
                  }}
                >
                  {isController ? 'Release' : 'Take Control'}
                </button>
                <span style={{
                  width: 1, height: 14,
                  background: 'rgb(26, 58, 92)',
                  flexShrink: 0,
                }} />
              </>
            )}
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
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Maximize"
                aria-label="Maximize"
              >
                <Maximize2 size={14} aria-hidden />
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
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Minimize"
                aria-label="Minimize"
              >
                <Minimize2 size={14} aria-hidden />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isController) return;
                onDestroy();
              }}
              style={{
                background: "none",
                border: "none",
                color: isController ? "rgb(255, 107, 107)" : "rgb(74, 97, 120)",
                cursor: isController ? "pointer" : "not-allowed",
                padding: "2px 4px",
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
              title={isController ? "Close terminal" : "Watch mode - cannot close"}
              aria-label={isController ? "Close terminal" : "Watch mode - cannot close"}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* Terminal content + side panel */}
        {maximized ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
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
                  isController={isController}
                />
              </div>
              {!isMobile && (
                <div style={{ width: 200, minWidth: 200, borderLeft: '1px solid rgb(26, 58, 92)' }}>
                  <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
                </div>
              )}
            </div>

            {/* Mobile ExtendedKeyBar */}
            {isMobile && (
              <ExtendedKeyBar
                onKey={handleToolbarKey}
                onToggleKeyboard={() => setKeyboardVisible(v => !v)}
                onToggleCommandBar={() => setCommandBarVisible(v => !v)}
                keyboardVisible={keyboardVisible}
                commandBarVisible={commandBarVisible}
                isController={isController}
              />
            )}

            {/* Mobile CommandBar bottom sheet */}
            {isMobile && commandBarVisible && (
              <div style={{
                borderTop: '1px solid rgb(26, 58, 92)',
                maxHeight: '40vh',
                overflow: 'auto',
              }}>
                <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
              </div>
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

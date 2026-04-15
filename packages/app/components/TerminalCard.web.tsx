import { lazy, memo, Suspense, useRef, useCallback, useEffect, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Maximize2, Minimize2, X, PanelRight } from "lucide-react";
import type { TerminalViewRef } from "./TerminalView.types";
import { ExtendedKeyBar } from "./ExtendedKeyBar";
import { CommandBar } from "./CommandBar";
import {
  getMaximizedBackdropStyle,
  getMaximizedTerminalFrame,
} from "./terminalLayout";
import { terminalWsUrl } from "@/lib/api";
import { colors } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

const LiveTerminalView = lazy(() =>
  import("./TerminalView.web").then((module) => ({
    default: module.TerminalView,
  })),
);

interface TerminalCardProps {
  terminal: TerminalInfo;
  maximized: boolean;
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  onMaximize: (terminalId: string) => void;
  onMinimize: () => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

function TerminalCardComponent({
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
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);
  const controlCopy = getTerminalControlCopy(isController);

  useEffect(() => {
    if (isController) {
      return;
    }
    setKeyboardVisible(false);
    setCommandBarVisible(false);
    setDesktopPanelOpen(false);
  }, [isController]);

  const handleToolbarKey = useCallback((data: string) => {
    if (!isController) return;
    termViewRef.current?.sendCommandInput(data);
    termViewRef.current?.focus();
  }, [isController]);

  const handleImagePaste = useCallback((base64: string, mime: string) => {
    if (!isController) return;
    termViewRef.current?.sendImagePaste(base64, mime);
  }, [isController]);

  const handleFitHere = useCallback(() => {
    if (!isController || !maximized) return;
    termViewRef.current?.fitToContainer();
    termViewRef.current?.focus();
  }, [isController, maximized]);

  const handleTitleClick = useCallback(() => {
    if (!maximized) onMaximize(terminal.id);
  }, [maximized, onMaximize, terminal.id]);

  const wsUrl = terminalWsUrl(terminal.machine_id, terminal.id, deviceId);

  return (
    <>
      {/* Backdrop overlay when maximized */}
      {maximized && (
        <div
          onClick={onMinimize}
          style={{
            position: "fixed",
            ...getMaximizedBackdropStyle(isMobile),
            zIndex: 99,
            background: "rgba(0, 0, 0, 0.7)",
          }}
        />
      )}

      <div
        data-testid={`terminal-card-${terminal.id}`}
        style={
          maximized
            ? {
                position: "fixed",
                ...getMaximizedTerminalFrame(isMobile),
                zIndex: 100,
                background: colors.surface,
                borderRadius: isMobile ? 0 : 8,
                border: isMobile
                  ? "none"
                  : `2px solid ${colors.accent}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }
            : {
                background: colors.surface,
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "border-color 0.2s",
              }
        }
        onMouseEnter={(e) => {
          if (!maximized)
            e.currentTarget.style.borderColor = colors.accent;
        }}
        onMouseLeave={(e) => {
          if (!maximized)
            e.currentTarget.style.borderColor = colors.border;
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: maximized ? "8px 12px" : "4px 8px",
            borderBottom: `1px solid ${colors.border}`,
            background: "rgba(0,0,0,0.2)",
            cursor: maximized ? "default" : "pointer",
          }}
          onClick={handleTitleClick}
        >
          {/* Left: close button — separated from other actions to prevent mis-taps */}
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isController) return;
                onDestroy(terminal);
              }}
              style={{
                background: "none",
                border: "none",
                color: isController ? colors.danger : colors.foregroundMuted,
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
              title={isController ? "Close terminal" : "View only - cannot close"}
              aria-label={isController ? "Close terminal" : "View only - cannot close"}
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
                background: colors.accent,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: maximized ? 13 : 11,
                color: colors.foreground,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {terminal.title}
            </span>
          </div>

          {/* Right: maximize/minimize + mode controls */}
          <div style={{ display: "flex", gap: isMobile ? 4 : 6, flexShrink: 0, alignItems: "center" }}>
            {/* Inline mode controls for mobile maximized — flat style, no container */}
            {maximized && isMobile && onRequestControl && onReleaseControl && (
              <>
                {isController && (
                  <>
                    <button
                      data-testid="terminal-fit-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFitHere();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: colors.accent,
                        cursor: "pointer",
                        fontSize: 11,
                        padding: isMobile ? "10px 8px" : "2px 4px",
                      }}
                    >
                      {controlCopy.sizeActionLabel}
                    </button>
                    <span style={{
                      width: 1, height: 14,
                      background: colors.border,
                      flexShrink: 0,
                    }} />
                  </>
                )}
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: isController ? colors.accent : colors.foregroundMuted,
                  flexShrink: 0,
                }} />
                <button
                  data-testid="terminal-mode-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isController) onReleaseControl?.(terminal.machine_id);
                    else onRequestControl?.(terminal.machine_id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: isController ? colors.foregroundSecondary : colors.accent,
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: isMobile ? '10px 8px' : '2px 4px',
                  }}
                >
                  {controlCopy.toggleLabel}
                </button>
                <span style={{
                  width: 1, height: 14,
                  background: colors.border,
                  flexShrink: 0,
                }} />
              </>
            )}
            {maximized && !isMobile && isController && (
              <button
                data-testid="terminal-fit-button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFitHere();
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.accent,
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "2px 4px",
                }}
                title="Fit terminal here"
                aria-label="Fit terminal here"
              >
                {controlCopy.sizeActionLabel}
              </button>
            )}
            {!maximized && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMaximize(terminal.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.foregroundSecondary,
                  cursor: "pointer",
                  padding: isMobile ? "10px 12px" : "2px 4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Maximize"
                aria-label="Maximize"
              >
                <Maximize2 size={14} aria-hidden />
              </button>
            )}
            {maximized && !isMobile && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDesktopPanelOpen(v => !v);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: desktopPanelOpen ? colors.accent : colors.foregroundSecondary,
                  cursor: "pointer",
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title={desktopPanelOpen ? "Hide control panel" : "Show control panel"}
                aria-label={desktopPanelOpen ? "Hide control panel" : "Show control panel"}
              >
                <PanelRight size={14} aria-hidden />
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
                  color: colors.foregroundSecondary,
                  cursor: "pointer",
                  padding: isMobile ? "10px 12px" : "2px 4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Minimize"
                aria-label="Minimize"
              >
                <Minimize2 size={14} aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* Terminal content + side panel */}
        <div
          style={maximized ? {
            flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0,
          } : {
            aspectRatio: "5 / 3", overflow: "hidden", cursor: "pointer", position: "relative",
          }}
          onClick={maximized ? undefined : () => onMaximize(terminal.id)}
        >
          <div style={maximized ? {
            flex: 1, display: "flex", overflow: "hidden", minHeight: 0,
          } : {
            width: "100%", height: "100%", pointerEvents: "none" as const, overflow: "hidden",
          }}>
            <div style={maximized ? {
              flex: 1, padding: "8px 10px", overflow: "hidden",
            } : {
              width: "100%", height: "100%",
            }}>
              <Suspense
                fallback={
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: colors.foregroundSecondary,
                      fontSize: 12,
                    }}
                  >
                    Loading terminal…
                  </div>
                }
              >
                <LiveTerminalView
                  ref={termViewRef}
                  machineId={terminal.machine_id}
                  terminalId={terminal.id}
                  wsUrl={wsUrl}
                  cols={terminal.cols}
                  rows={terminal.rows}
                  displayMode={maximized ? "immersive" : "card"}
                  isController={isController}
                  canResizeTerminal={maximized && isController}
                  style={
                    maximized
                      ? undefined
                      : {
                          transform: "scale(0.35)",
                          transformOrigin: "top left",
                          width: "286%",
                          height: "286%",
                        }
                  }
                />
              </Suspense>
            </div>
            {maximized && !isMobile && desktopPanelOpen && (
              <div style={{ width: 200, minWidth: 200, borderLeft: `1px solid ${colors.border}` }}>
                <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
              </div>
            )}
          </div>

          {/* Mobile ExtendedKeyBar */}
          {maximized && isMobile && (
            <ExtendedKeyBar
              onKey={handleToolbarKey}
              onToggleKeyboard={() => setKeyboardVisible(v => !v)}
              onToggleCommandBar={() => {
                if (!isController) return;
                setCommandBarVisible(v => !v);
              }}
              keyboardVisible={keyboardVisible}
              commandBarVisible={commandBarVisible}
              isController={isController}
            />
          )}

          {/* Mobile CommandBar bottom sheet */}
          {maximized && isMobile && commandBarVisible && (
            <div style={{
              borderTop: `1px solid ${colors.border}`,
              maxHeight: '40vh',
              overflow: 'auto',
            }}>
              <CommandBar onSend={handleToolbarKey} onImagePaste={handleImagePaste} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: maximized ? "4px 12px" : "2px 8px",
            borderTop: `1px solid ${colors.border}`,
            fontSize: maximized ? 11 : 9,
            color: colors.foregroundMuted,
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

function areTerminalCardPropsEqual(
  previous: TerminalCardProps,
  next: TerminalCardProps,
): boolean {
  return (
    previous.terminal === next.terminal &&
    previous.maximized === next.maximized &&
    previous.isMobile === next.isMobile &&
    previous.isController === next.isController &&
    previous.deviceId === next.deviceId &&
    previous.onMaximize === next.onMaximize &&
    previous.onMinimize === next.onMinimize &&
    previous.onDestroy === next.onDestroy &&
    previous.onRequestControl === next.onRequestControl &&
    previous.onReleaseControl === next.onReleaseControl
  );
}

export const TerminalCard = memo(TerminalCardComponent, areTerminalCardPropsEqual);

import { lazy, memo, Suspense, useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Maximize2, X } from "lucide-react";
import type { TerminalViewRef } from "./TerminalView.types";
import { ExtendedKeyBar } from "./ExtendedKeyBar";
import { terminalWsUrl } from "@/lib/api";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

const LiveTerminalView = lazy(() =>
  import("./TerminalView.web").then((module) => ({
    default: module.TerminalView,
  })),
);

const FIT_REF_RETRY_LIMIT = 10;
const FIT_REF_RETRY_DELAY_MS = 100;

export interface TerminalCardRef {
  fitToContainer: () => void;
  focus: () => void;
  sendInput: (data: string) => void;
}

interface TerminalCardProps {
  terminal: TerminalInfo;
  displayMode: "card" | "tab";
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  workpathLabel?: string; // shown in the top-left of the card body when in card mode
  onSelectTab: (id: string | null) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

const TerminalCardComponent = forwardRef<TerminalCardRef, TerminalCardProps>(function TerminalCardComponent({
  terminal,
  displayMode,
  isMobile,
  isController,
  deviceId,
  workpathLabel,
  onSelectTab,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}, ref) {
  const termViewRef = useRef<TerminalViewRef>(null);
  const fitRefRetryTimer = useRef<number | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const controlCopy = getTerminalControlCopy(isController);
  const isTab = displayMode === "tab";

  const clearFitRefRetryTimer = useCallback(() => {
    if (fitRefRetryTimer.current !== null) {
      window.clearTimeout(fitRefRetryTimer.current);
      fitRefRetryTimer.current = null;
    }
  }, []);

  const fitToContainer = useCallback(
    (attempt = 0) => {
      if (!isController || !isTab) return;
      const view = termViewRef.current;
      if (!view) {
        if (attempt >= FIT_REF_RETRY_LIMIT) return;
        clearFitRefRetryTimer();
        fitRefRetryTimer.current = window.setTimeout(() => {
          fitRefRetryTimer.current = null;
          fitToContainer(attempt + 1);
        }, FIT_REF_RETRY_DELAY_MS);
        return;
      }
      clearFitRefRetryTimer();
      view.fitToContainer();
      view.focus();
    },
    [clearFitRefRetryTimer, isController, isTab],
  );

  useEffect(() => clearFitRefRetryTimer, [clearFitRefRetryTimer]);

  useImperativeHandle(ref, () => ({
    fitToContainer: () => {
      fitToContainer();
    },
    focus: () => {
      termViewRef.current?.focus();
    },
    sendInput: (data: string) => {
      termViewRef.current?.sendInput(data);
    },
  }), [fitToContainer]);

  useEffect(() => {
    if (isController) {
      return;
    }
    setKeyboardVisible(false);
  }, [isController]);

  const handleToolbarKey = useCallback((data: string) => {
    if (!isController) return;
    termViewRef.current?.sendCommandInput(data);
    termViewRef.current?.focus();
  }, [isController]);

  const handleCardClick = useCallback(() => {
    if (!isTab) onSelectTab(terminal.id);
  }, [isTab, onSelectTab, terminal.id]);

  const wsUrl = terminal.reachable
    ? terminalWsUrl(terminal.machine_id, terminal.id, deviceId)
    : null;

  return (
    <div
      data-testid={`terminal-card-${terminal.id}`}
      style={
        isTab
          ? {
              flex: 1,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column" as const,
              background: colors.surface,
            }
          : {
              position: "relative" as const,
              background: colors.surface,
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column" as const,
              transition: "border-color 0.2s",
            }
      }
      onMouseEnter={(e) => {
        if (!isTab)
          e.currentTarget.style.borderColor = colors.accent;
      }}
      onMouseLeave={(e) => {
        if (!isTab)
          e.currentTarget.style.borderColor = colors.border;
      }}
    >
      {!terminal.reachable && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.6)",
            zIndex: 10,
            borderRadius: "inherit",
            pointerEvents: "all",
          }}
        >
          <span style={{ color: colors.foregroundSecondary, fontSize: 14 }}>
            Waiting for reconnection…
          </span>
        </div>
      )}

      {/* Desktop fit lives in ExpandedTerminal's header; resizing stays
          explicit so running TUIs are not resized mid-frame. */}

      {/* Mobile controls bar in tab mode */}
      {isTab && isMobile && onRequestControl && onReleaseControl && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 10px",
            borderBottom: `1px solid ${colors.border}`,
            background: colors.bg1,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              color: isController ? colors.accent : colors.foregroundMuted,
              fontSize: 12,
              fontWeight: 650,
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isController ? colors.accent : colors.foregroundMuted,
              flexShrink: 0,
            }} />
            <span style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}>
              {controlCopy.modeLabel}
            </span>
          </div>
          <div style={{ display: "flex", gap: 7, flexShrink: 0, alignItems: "center" }}>
            {isController && (
              <button
                data-testid="terminal-fit-button"
                onClick={() => {
                  fitToContainer();
                }}
                style={{
                  minHeight: 38,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: colorAlpha.accentSoft,
                  border: `1px solid ${colorAlpha.accentLine}`,
                  borderRadius: 9,
                  color: colors.accent,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "0 11px",
                  whiteSpace: "nowrap",
                }}
              >
                <Maximize2 size={14} />
                <span>{controlCopy.sizeActionLabel}</span>
              </button>
            )}
            <button
              data-testid="terminal-mode-toggle"
              onClick={() => {
                if (isController) onReleaseControl?.(terminal.machine_id);
                else onRequestControl?.(terminal.machine_id);
              }}
              style={{
                minHeight: 38,
                background: isController ? colors.bg2 : colors.accent,
                border: `1px solid ${
                  isController ? colors.border : colors.accent
                }`,
                borderRadius: 9,
                color: isController ? colors.foregroundSecondary : "#120904",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 750,
                padding: "0 11px",
                whiteSpace: "nowrap",
              }}
            >
              {controlCopy.toggleLabel}
            </button>
          </div>
        </div>
      )}

      {/* Card mode: title bar */}
      {!isTab && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 8px",
            borderBottom: `1px solid ${colors.border}`,
            background: "rgba(0,0,0,0.2)",
            cursor: "pointer",
          }}
          onClick={handleCardClick}
        >
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
                fontSize: 11,
                color: colors.foreground,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {terminal.title}
            </span>
          </div>
        </div>
      )}

      {/* Workpath label overlay — card mode only */}
      {!isTab && workpathLabel && (
        <div
          data-testid="terminal-card-workpath-label"
          style={{
            position: "absolute",
            top: 6,
            left: 8,
            fontSize: 9,
            color: colors.foregroundMuted,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {workpathLabel}
        </div>
      )}

      {/* Terminal content */}
      <div
        style={isTab ? {
          flex: 1, display: "flex", flexDirection: "column" as const, overflow: "hidden", minHeight: 0,
        } : {
          aspectRatio: "5 / 3", overflow: "hidden", cursor: "pointer", position: "relative" as const,
        }}
        onClick={isTab ? undefined : handleCardClick}
      >
        <div style={isTab ? {
          flex: 1, display: "flex", overflow: "hidden", minHeight: 0,
        } : {
          width: "100%", height: "100%", pointerEvents: "none" as const, overflow: "hidden",
        }}>
          <div style={isTab ? {
            flex: 1, padding: "8px 10px", overflow: "hidden", background: terminalTheme.background,
          } : {
            width: "100%", height: "100%",
          }}>
            {terminal.reachable ? (
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
                  wsUrl={wsUrl!}
                  cols={terminal.cols}
                  rows={terminal.rows}
                  displayMode={isTab ? "immersive" : "card"}
                  isController={isController}
                  canResizeTerminal={isTab && isController}
                  style={
                    isTab
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
            ) : null}
          </div>
        </div>

        {/* Mobile ExtendedKeyBar */}
        {isTab && isMobile && (
          <ExtendedKeyBar
            onKey={handleToolbarKey}
            onToggleKeyboard={() => setKeyboardVisible(v => !v)}
            keyboardVisible={keyboardVisible}
            isController={isController}
          />
        )}
      </div>

      {/* Footer - only in card mode */}
      {!isTab && (
        <div
          style={{
            padding: "2px 8px",
            borderTop: `1px solid ${colors.border}`,
            fontSize: 9,
            color: colors.foregroundMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {terminal.cwd}
        </div>
      )}
    </div>
  );
});

function areTerminalCardPropsEqual(
  previous: TerminalCardProps,
  next: TerminalCardProps,
): boolean {
  return (
    previous.terminal === next.terminal &&
    previous.displayMode === next.displayMode &&
    previous.isMobile === next.isMobile &&
    previous.isController === next.isController &&
    previous.deviceId === next.deviceId &&
    previous.workpathLabel === next.workpathLabel &&
    previous.onSelectTab === next.onSelectTab &&
    previous.onDestroy === next.onDestroy &&
    previous.onRequestControl === next.onRequestControl &&
    previous.onReleaseControl === next.onReleaseControl
  );
}

export const TerminalCard = memo(TerminalCardComponent, areTerminalCardPropsEqual);

import { lazy, memo, Suspense, useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { X } from "lucide-react";
import type { TerminalViewRef, SelectionSnapshot } from "./TerminalView.types";
import { ExtendedKeyBar } from "./ExtendedKeyBar";
import { TerminalPreviewText } from "./TerminalPreviewText.web";
import { terminalWsUrl } from "@/lib/api";
import { colors, terminalTheme } from "@/lib/colors";

const LiveTerminalView = lazy(() =>
  import("./TerminalView.web").then((module) => ({
    default: module.TerminalView,
  })),
);

const FIT_REF_RETRY_LIMIT = 10;
const FIT_REF_RETRY_DELAY_MS = 100;

export interface TerminalCardRef {
  fitToContainer: (opts?: {
    skipIfUnchanged?: boolean;
    focusAfterFit?: boolean;
  }) => void;
  focus: () => void;
  blur: () => void;
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
  const selectOverlayRef = useRef<HTMLPreElement>(null);
  const fitRefRetryTimer = useRef<number | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectSnapshot, setSelectSnapshot] = useState<SelectionSnapshot | null>(null);
  const isTab = displayMode === "tab";

  const clearFitRefRetryTimer = useCallback(() => {
    if (fitRefRetryTimer.current !== null) {
      window.clearTimeout(fitRefRetryTimer.current);
      fitRefRetryTimer.current = null;
    }
  }, []);

  const fitToContainer = useCallback(
    (
      opts: {
        attempt?: number;
        skipIfUnchanged?: boolean;
        focusAfterFit?: boolean;
      } = {},
    ) => {
      const attempt = opts.attempt ?? 0;
      const skipIfUnchanged = opts.skipIfUnchanged ?? false;
      const focusAfterFit = opts.focusAfterFit ?? true;
      if (!isController || !isTab) return;
      const view = termViewRef.current;
      if (!view) {
        if (attempt >= FIT_REF_RETRY_LIMIT) return;
        clearFitRefRetryTimer();
        fitRefRetryTimer.current = window.setTimeout(() => {
          fitRefRetryTimer.current = null;
          fitToContainer({
            attempt: attempt + 1,
            skipIfUnchanged,
            focusAfterFit,
          });
        }, FIT_REF_RETRY_DELAY_MS);
        return;
      }
      clearFitRefRetryTimer();
      view.fitToContainer({ skipIfUnchanged });
      if (!isMobile && focusAfterFit) {
        view.focus();
      }
    },
    [clearFitRefRetryTimer, isController, isMobile, isTab],
  );

  useEffect(() => clearFitRefRetryTimer, [clearFitRefRetryTimer]);

  useImperativeHandle(ref, () => ({
    fitToContainer: (opts) => {
      fitToContainer(opts);
    },
    focus: () => {
      termViewRef.current?.focus();
    },
    blur: () => {
      termViewRef.current?.blur();
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
  }, [isController]);

  const handleAttachFile = useCallback(async (file: File) => {
    if (!isController) return;
    try {
      await termViewRef.current?.sendImageFile(file);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[webmux] attach file failed", err);
      // Mobile users can't see console.warn — alert is the only surface
      // we have until there's a toast system. Without it the failure looks
      // identical to a successful upload that produced no terminal echo.
      const msg = err instanceof Error ? err.message : "Image upload failed.";
      if (typeof window !== "undefined") {
        window.alert(msg);
      }
    }
  }, [isController]);

  const handleToggleKeyboard = useCallback(() => {
    if (!isController) return;
    const nextVisible = !keyboardVisible;
    setKeyboardVisible(nextVisible);
    if (nextVisible) {
      termViewRef.current?.focus();
    } else {
      termViewRef.current?.blur();
    }
  }, [isController, keyboardVisible]);

  const handleEnterSelectMode = useCallback(() => {
    if (!isController) return;
    // Snapshot the visible viewport BEFORE we touch focus or mouse modes
    // so we render exactly what was on screen when the user tapped.
    const snapshot = termViewRef.current?.getSelectionSnapshot() ?? null;
    if (!snapshot) return;
    termViewRef.current?.setMouseTrackingEnabled(false);
    // Drop focus so the soft keyboard retreats and the user has the
    // whole terminal area free for the long-press gesture.
    termViewRef.current?.blur();
    setKeyboardVisible(false);
    setSelectSnapshot(snapshot);
    setSelectMode(true);
  }, [isController]);

  const handleExitSelectMode = useCallback(() => {
    termViewRef.current?.setMouseTrackingEnabled(true);
    setSelectMode(false);
    setSelectSnapshot(null);
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  }, []);

  const handleCopySelection = useCallback(async () => {
    // Pull from the browser's native selection (the user dragged on the
    // overlay) rather than xterm.getSelection() — xterm has no idea what
    // was selected because the overlay sits above its canvas.
    const text =
      typeof window !== "undefined"
        ? window.getSelection()?.toString() ?? ""
        : "";
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[webmux] clipboard write failed", err);
      }
    }
    handleExitSelectMode();
    return text;
  }, [handleExitSelectMode]);

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

      {/* Mobile controls (Stop Control / Fit / Controlling indicator)
          used to live here as a separate row, but they duplicated the
          header — the ctrl pill in ExpandedTerminal's header now toggles
          control, and the Fit icon stayed in the header. The keybar's
          accent-tinted buttons already signal "Controlling". */}

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
            position: "relative" as const,
          } : {
            width: "100%", height: "100%",
          }}>
            {terminal.reachable && isTab ? (
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
                  key={terminal.id}
                  ref={termViewRef}
                  machineId={terminal.machine_id}
                  terminalId={terminal.id}
                  wsUrl={wsUrl!}
                  cols={terminal.cols}
                  rows={terminal.rows}
                  displayMode={isTab ? "immersive" : "card"}
                  isController={isController}
                  canResizeTerminal={isTab && isController}
                />
              </Suspense>
            ) : !isTab ? (
              <TerminalPreviewText
                machineId={terminal.machine_id}
                terminalId={terminal.id}
                cols={terminal.cols}
                rows={terminal.rows}
                reachable={terminal.reachable}
                enabled={terminal.reachable}
                maxLines={8}
                maxLineWidth={160}
                lineHeightPx={15}
                padding={10}
              />
            ) : null}

            {/* Mobile select overlay — xterm renders to canvas so its
                text isn't selectable by touch (xterm.js #3727). When
                select mode is active we paint the visible viewport on
                top as a <pre>, where browser long-press selection works
                natively. The user drags handles, taps Copy, we read
                window.getSelection(). */}
            {isTab && isMobile && selectMode && selectSnapshot && (
              <pre
                ref={selectOverlayRef}
                data-testid="terminal-select-overlay"
                style={{
                  position: "absolute",
                  inset: 0,
                  margin: 0,
                  padding: "8px 10px",
                  background: terminalTheme.background,
                  color: terminalTheme.foreground,
                  fontFamily: selectSnapshot.fontFamily,
                  fontSize: selectSnapshot.fontSize,
                  // Slightly looser line-height so soft-wrapped lines
                  // are easier to read than xterm's compact 1.0.
                  lineHeight: 1.25,
                  // pre-wrap (not pre): preserve real \n separators but
                  // let the browser soft-wrap long logical lines so the
                  // overlay doesn't scroll sideways. Combined with
                  // overflow-wrap: anywhere so an unbroken token still
                  // wraps inside the viewport.
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  overflow: "auto",
                  zIndex: 6,
                  // Allow native long-press selection on touch devices —
                  // global CSS sets `touch-action: manipulation` on *,
                  // which we override here so the browser treats touches
                  // as potential selection gestures.
                  touchAction: "auto",
                  WebkitUserSelect: "text",
                  userSelect: "text",
                  WebkitTouchCallout: "default",
                  cursor: "text",
                }}
              >
                {selectSnapshot.lines.join("\n")}
              </pre>
            )}
          </div>
        </div>

        {/* Mobile ExtendedKeyBar */}
        {isTab && isMobile && (
          <ExtendedKeyBar
            onKey={handleToolbarKey}
            onToggleKeyboard={handleToggleKeyboard}
            onAttachFile={handleAttachFile}
            onEnterSelectMode={handleEnterSelectMode}
            onExitSelectMode={handleExitSelectMode}
            onCopySelection={handleCopySelection}
            selectMode={selectMode}
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

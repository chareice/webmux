import { useRef, useCallback, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Minimize2, X, PanelRight } from "lucide-react";
import { TerminalView } from "./TerminalView.web";
import type { TerminalViewRef } from "./TerminalView.types";
import { ExtendedKeyBar } from "./ExtendedKeyBar";
import { CommandBar } from "./CommandBar";
import { terminalWsUrl } from "@/lib/api";

interface TabContainerProps {
  terminals: TerminalInfo[];
  openTabs: string[];
  activeTabId: string;
  isMobile: boolean;
  isController: boolean;
  deviceId: string;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onDestroyTerminal: (terminal: TerminalInfo) => void;
  onRequestControl?: () => void;
  onReleaseControl?: () => void;
}

export function TabContainer({
  terminals,
  openTabs,
  activeTabId,
  isMobile,
  isController,
  deviceId,
  onActivateTab,
  onCloseTab,
  onCloseAllTabs,
  onDestroyTerminal,
  onRequestControl,
  onReleaseControl,
}: TabContainerProps) {
  const termViewRefs = useRef<Map<string, TerminalViewRef>>(new Map());
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [commandBarVisible, setCommandBarVisible] = useState(false);
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);

  const handleToolbarKey = useCallback(
    (data: string) => {
      const ref = termViewRefs.current.get(activeTabId);
      ref?.sendCommandInput(data);
      if (isController) ref?.focus();
    },
    [activeTabId, isController],
  );

  const handleImagePaste = useCallback(
    (base64: string, mime: string) => {
      const ref = termViewRefs.current.get(activeTabId);
      ref?.sendImagePaste(base64, mime);
    },
    [activeTabId],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCloseAllTabs}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99,
          background: "rgba(0, 0, 0, 0.7)",
          backdropFilter: "blur(4px)",
        }}
      />

      {/* Container */}
      <div
        style={{
          position: "fixed",
          top: isMobile ? 0 : "5vh",
          left: isMobile ? 0 : "5vw",
          width: isMobile ? "100vw" : "90vw",
          height: isMobile ? "100dvh" : "90vh",
          zIndex: 100,
          background: "rgb(17, 42, 69)",
          borderRadius: isMobile ? 0 : 8,
          border: isMobile ? "none" : "2px solid rgb(0, 212, 170)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            borderBottom: "1px solid rgb(26, 58, 92)",
            background: "rgba(0,0,0,0.2)",
            height: isMobile ? 44 : 36,
            flexShrink: 0,
          }}
        >
          {/* Scrollable tabs */}
          <div
            style={{
              flex: 1,
              display: "flex",
              overflow: "auto",
              scrollbarWidth: "none",
              minWidth: 0,
            }}
          >
            {openTabs.map((tabId) => {
              const term = terminals.find((t) => t.id === tabId);
              const isActive = tabId === activeTabId;
              return (
                <div
                  key={tabId}
                  onClick={() => onActivateTab(tabId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: isMobile ? "0 10px" : "0 12px",
                    borderRight: "1px solid rgb(26, 58, 92)",
                    borderBottom: isActive
                      ? "2px solid rgb(0, 212, 170)"
                      : "2px solid transparent",
                    background: isActive
                      ? "rgba(0, 212, 170, 0.08)"
                      : "transparent",
                    cursor: "pointer",
                    flexShrink: 0,
                    minWidth: 0,
                    maxWidth: isMobile ? 160 : 200,
                    userSelect: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.03)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: isActive
                        ? "rgb(0, 212, 170)"
                        : "rgb(74, 97, 120)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: isActive
                        ? "rgb(224, 232, 240)"
                        : "rgb(122, 143, 166)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {term?.title || tabId.slice(0, 8)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tabId);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgb(74, 97, 120)",
                      cursor: "pointer",
                      padding: isMobile ? "8px 4px" : "2px 4px",
                      fontSize: 10,
                      lineHeight: 1,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "rgb(224, 232, 240)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "rgb(74, 97, 120)";
                    }}
                    title="Close tab"
                  >
                    &#x2715;
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right side controls */}
          <div
            style={{
              display: "flex",
              gap: isMobile ? 4 : 6,
              alignItems: "center",
              paddingRight: isMobile ? 6 : 8,
              paddingLeft: 6,
              flexShrink: 0,
            }}
          >
            {/* Mobile mode controls */}
            {isMobile && onRequestControl && onReleaseControl && (
              <>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: isController
                      ? "rgb(0, 212, 170)"
                      : "rgb(74, 97, 120)",
                    flexShrink: 0,
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isController) onReleaseControl();
                    else onRequestControl();
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: isController
                      ? "rgb(122, 143, 166)"
                      : "rgb(0, 212, 170)",
                    cursor: "pointer",
                    fontSize: 11,
                    padding: isMobile ? "10px 8px" : "2px 4px",
                  }}
                >
                  {isController ? "Release" : "Take Control"}
                </button>
                <span
                  style={{
                    width: 1,
                    height: 14,
                    background: "rgb(26, 58, 92)",
                    flexShrink: 0,
                  }}
                />
              </>
            )}
            {/* Desktop panel toggle */}
            {!isMobile && (
              <button
                onClick={() => setDesktopPanelOpen((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  color: desktopPanelOpen
                    ? "rgb(0, 212, 170)"
                    : "rgb(122, 143, 166)",
                  cursor: "pointer",
                  padding: "2px 4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title={
                  desktopPanelOpen
                    ? "Hide control panel"
                    : "Show control panel"
                }
                aria-label={
                  desktopPanelOpen
                    ? "Hide control panel"
                    : "Show control panel"
                }
              >
                <PanelRight size={14} aria-hidden />
              </button>
            )}
            {/* Minimize (back to grid) */}
            <button
              onClick={onCloseAllTabs}
              style={{
                background: "none",
                border: "none",
                color: "rgb(122, 143, 166)",
                cursor: "pointer",
                padding: isMobile ? "10px 12px" : "2px 4px",
                display: "flex",
                alignItems: "center",
              }}
              title="Back to grid"
              aria-label="Back to grid"
            >
              <Minimize2 size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* Terminal panes — all mounted, only active visible */}
        {openTabs.map((tabId) => {
          const term = terminals.find((t) => t.id === tabId);
          if (!term) return null;
          const isActive = tabId === activeTabId;
          const wsUrl = terminalWsUrl(term.machine_id, term.id, deviceId);

          return (
            <div
              key={tabId}
              style={{
                flex: 1,
                display: isActive ? "flex" : "none",
                flexDirection: "column",
                overflow: "hidden",
                minHeight: 0,
              }}
            >
              {/* Terminal + side command bar */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  overflow: "hidden",
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    overflow: "hidden",
                  }}
                >
                  <TerminalView
                    ref={(r) => {
                      if (r) termViewRefs.current.set(tabId, r);
                      else termViewRefs.current.delete(tabId);
                    }}
                    machineId={term.machine_id}
                    terminalId={term.id}
                    wsUrl={wsUrl}
                    isController={isController}
                  />
                </div>
                {!isMobile && desktopPanelOpen && (
                  <div
                    style={{
                      width: 200,
                      minWidth: 200,
                      borderLeft: "1px solid rgb(26, 58, 92)",
                    }}
                  >
                    <CommandBar
                      onSend={handleToolbarKey}
                      onImagePaste={handleImagePaste}
                    />
                  </div>
                )}
              </div>

              {/* Mobile ExtendedKeyBar */}
              {isMobile && (
                <ExtendedKeyBar
                  onKey={handleToolbarKey}
                  onToggleKeyboard={() => setKeyboardVisible((v) => !v)}
                  onToggleCommandBar={() => setCommandBarVisible((v) => !v)}
                  keyboardVisible={keyboardVisible}
                  commandBarVisible={commandBarVisible}
                  isController={isController}
                />
              )}

              {/* Mobile CommandBar bottom sheet */}
              {isMobile && commandBarVisible && (
                <div
                  style={{
                    borderTop: "1px solid rgb(26, 58, 92)",
                    maxHeight: "40vh",
                    overflow: "auto",
                  }}
                >
                  <CommandBar
                    onSend={handleToolbarKey}
                    onImagePaste={handleImagePaste}
                  />
                </div>
              )}

              {/* Footer */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 12px",
                  borderTop: "1px solid rgb(26, 58, 92)",
                  fontSize: 11,
                  color: "rgb(74, 97, 120)",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {term.cwd}
                </span>
                {isController && (
                  <button
                    onClick={() => onDestroyTerminal(term)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgb(255, 107, 107)",
                      cursor: "pointer",
                      padding: "2px 6px",
                      fontSize: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      opacity: 0.6,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = "0.6";
                    }}
                    title="Close terminal"
                  >
                    <X size={12} aria-hidden />
                    <span>Close Terminal</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

import { memo, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { LayoutGrid, X, Plus } from "lucide-react";
import { colors } from "@/lib/colors";
import { isTauri, detectOS } from "@/lib/platform";
import { WindowControls } from "./WindowControls";

interface TitleBarProps {
  terminals: TerminalInfo[];
  activeTabId: string | null;
  isMobile: boolean;
  onSelectTab: (id: string | null) => void;
  onCloseTab: (terminal: TerminalInfo) => void;
  onNewTerminal?: () => void;
  onReorderTabs?: (newOrder: string[]) => void;
}

function TitleBarComponent({
  terminals,
  activeTabId,
  isMobile,
  onSelectTab,
  onCloseTab,
  onNewTerminal,
  onReorderTabs,
}: TitleBarProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  if (terminals.length === 0 && !isTauri()) return null;

  const isDesktop = isTauri();
  const isMac = isDesktop && detectOS() === "macos";

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        flexShrink: 0,
        minHeight: isMobile ? 40 : 36,
        userSelect: "none",
        WebkitAppRegion: isDesktop ? "drag" : undefined,
      } as React.CSSProperties}
    >
      {/* macOS: window controls on the left */}
      {isMac && <WindowControls position="left" />}

      {/* Scrollable tabs area — drag region for empty space */}
      <div
        data-tauri-drag-region={isDesktop ? "" : undefined}
        style={{
          display: "flex",
          alignItems: "stretch",
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {/* All tab */}
        <button
          data-testid="tab-all"
          onClick={() => onSelectTab(null)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: isMobile ? "8px 14px" : "6px 14px",
            background: activeTabId === null ? colors.background : "transparent",
            border: "none",
            borderBottom: activeTabId === null
              ? `2px solid ${colors.accent}`
              : "2px solid transparent",
            color: activeTabId === null ? colors.foreground : colors.foregroundSecondary,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: activeTabId === null ? 600 : 400,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          <LayoutGrid size={14} />
          All
        </button>

        {/* Terminal tabs */}
        {terminals.map((terminal) => {
          const isActive = activeTabId === terminal.id;
          const idx = terminals.findIndex((t) => t.id === terminal.id);
          return (
            <div
              key={terminal.id}
              draggable={!isMobile}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", terminal.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                setDragOverIndex(e.clientX < midX ? idx : idx + 1);
              }}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={(e) => {
                e.preventDefault();
                const draggedId = e.dataTransfer.getData("text/plain");
                if (!draggedId || !onReorderTabs) return;
                const currentOrder = terminals.map((t) => t.id);
                const fromIndex = currentOrder.indexOf(draggedId);
                if (fromIndex === -1) return;
                const newOrder = currentOrder.filter((id) => id !== draggedId);
                const rect = e.currentTarget.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                let toIndex = currentOrder.indexOf(terminal.id);
                if (e.clientX >= midX) toIndex++;
                if (fromIndex < toIndex) toIndex--;
                newOrder.splice(toIndex, 0, draggedId);
                onReorderTabs(newOrder);
                setDragOverIndex(null);
              }}
              onDragEnd={() => setDragOverIndex(null)}
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: isActive
                  ? `2px solid ${colors.accent}`
                  : "2px solid transparent",
                background: isActive ? colors.background : "transparent",
                flexShrink: 0,
                maxWidth: 280,
                position: "relative",
                ...(dragOverIndex === idx ? {
                  borderLeft: `2px solid ${colors.accent}`,
                } : {}),
              }}
            >
              <button
                data-testid={`tab-${terminal.id}`}
                onClick={() => onSelectTab(terminal.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: isMobile ? "8px 8px 8px 14px" : "6px 6px 6px 14px",
                  background: "none",
                  border: "none",
                  color: isActive ? colors.foreground : colors.foregroundSecondary,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: colors.accent,
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  alignItems: "flex-start",
                }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.3 }}>
                    {terminal.title}
                  </span>
                  {terminal.cwd && (
                    <span style={{
                      fontSize: 10,
                      color: colors.foregroundMuted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                      lineHeight: 1.2,
                    }}>
                      {terminal.cwd}
                    </span>
                  )}
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(terminal);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: isMobile ? "8px 8px" : "4px 6px",
                  background: "none",
                  border: "none",
                  color: colors.foregroundMuted,
                  cursor: "pointer",
                  opacity: 0.5,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.color = colors.danger;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "0.5";
                  e.currentTarget.style.color = colors.foregroundMuted;
                }}
                title="Close terminal"
                aria-label="Close terminal"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {/* End-of-list drop indicator */}
        {dragOverIndex === terminals.length && (
          <div style={{
            width: 2,
            alignSelf: "stretch",
            background: colors.accent,
            flexShrink: 0,
          }} />
        )}

        {/* New terminal button */}
        {onNewTerminal && (
          <button
            onClick={onNewTerminal}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: "none",
              border: "none",
              color: colors.foregroundMuted,
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.foreground; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.foregroundMuted; }}
            title="New terminal (Ctrl+Shift+T)"
            aria-label="New terminal"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Window controls — right side (Windows/Linux only) */}
      <WindowControls position="right" />
    </div>
  );
}

export const TitleBar = memo(TitleBarComponent);

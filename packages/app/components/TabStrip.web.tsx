import { memo, useEffect, useRef, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Plus, X, MoreHorizontal } from "lucide-react";
import { colors } from "@/lib/colors";

export interface QuickCommand {
  label: string;
  command: string;
}

interface TabStripProps {
  // Terminals belonging to the active workpath, in creation order.
  tabs: TerminalInfo[];
  // The terminal currently visible. May not equal any tab.id when a fallback
  // is being shown (workpath has terminals but no explicit zoom yet) — the
  // first tab is highlighted instead.
  activeTabId: string | null;
  canCreateTerminal: boolean;
  quickCommands: QuickCommand[];
  onSelectTab: (terminalId: string) => void;
  onCloseTab: (terminal: TerminalInfo) => void;
  onNewTerminal: () => void;
  onQuickCommand: (command: string) => void;
}

const MAX_INLINE_CHIPS = 3;

function TabStripComponent(props: TabStripProps) {
  const {
    tabs,
    activeTabId,
    canCreateTerminal,
    quickCommands,
    onSelectTab,
    onCloseTab,
    onNewTerminal,
    onQuickCommand,
  } = props;

  // Effective active id — falls back to the first tab when the parent has
  // no explicit zoom yet. See the spec's Canvas state table.
  const effectiveActive = activeTabId ?? tabs[0]?.id ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);

  // Wheel-to-horizontal scroll — same trick used elsewhere in the project
  // for mouse users without a horizontal trackpad.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      // Only intercept when the strip actually has overflow.
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Auto-scroll the active tab into view.
  useEffect(() => {
    if (!effectiveActive) return;
    const tabEl = scrollRef.current?.querySelector(
      `[data-testid="tab-${effectiveActive}"]`,
    ) as HTMLElement | null;
    tabEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [effectiveActive]);

  const visibleChips = quickCommands.filter((c) => c.label && c.command);
  const inlineChips = visibleChips.slice(0, MAX_INLINE_CHIPS);
  const overflowChips = visibleChips.slice(MAX_INLINE_CHIPS);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  return (
    <div
      data-testid="tab-strip"
      style={{
        display: "flex",
        alignItems: "stretch",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        height: 32,
        flexShrink: 0,
      }}
    >
      <div
        ref={scrollRef}
        role="tablist"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "stretch",
          gap: 1,
          paddingLeft: 8,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((t) => {
          const isActive = effectiveActive === t.id;
          const live = true; // placeholder — no per-tab live signal yet
          return (
            <div
              key={t.id}
              data-testid={`tab-${t.id}`}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectTab(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectTab(t.id);
                }
              }}
              onMouseEnter={() => setHoveredTabId(t.id)}
              onMouseLeave={() => setHoveredTabId((cur) => (cur === t.id ? null : cur))}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: isActive ? colors.background : "transparent",
                borderTop: isActive
                  ? `2px solid ${colors.accent}`
                  : "2px solid transparent",
                borderLeft: `1px solid ${colors.border}`,
                borderRight: `1px solid ${colors.border}`,
                padding: "0 10px",
                color: isActive ? colors.foreground : colors.foregroundSecondary,
                cursor: "pointer",
                fontSize: 11,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: live ? colors.accent : colors.foregroundMuted,
                  flexShrink: 0,
                }}
              />
              <span>{t.title || t.id.slice(0, 8)}</span>
              {(isActive || hoveredTabId === t.id) && (
                <button
                  data-testid={`tab-close-${t.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(t);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: colors.foregroundMuted,
                    cursor: "pointer",
                    padding: 2,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                  aria-label={`Close ${t.title || t.id}`}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          borderLeft: `1px solid ${colors.border}`,
          flexShrink: 0,
          background: colors.surface,
        }}
      >
        {canCreateTerminal && (
          <>
            <button
              data-testid="tab-new"
              onClick={onNewTerminal}
              title="New terminal"
              aria-label="New terminal"
              style={{
                background: "none",
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                color: colors.foregroundMuted,
                cursor: "pointer",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <Plus size={12} />
            </button>
            {inlineChips.map((cmd) => (
              <button
                key={cmd.label}
                data-testid={`tab-quick-cmd-${cmd.label}`}
                onClick={() => onQuickCommand(cmd.command)}
                style={{
                  background: "rgba(217, 119, 87, 0.12)",
                  color: colors.accent,
                  border: "1px solid rgba(217, 119, 87, 0.3)",
                  borderRadius: 4,
                  fontSize: 10,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {cmd.label}
              </button>
            ))}
            {overflowChips.length > 0 && (
              <div style={{ position: "relative" }}>
                <button
                  data-testid="tab-quick-cmd-more"
                  onClick={() => setOverflowOpen((v) => !v)}
                  title="More quick commands"
                  aria-label="More quick commands"
                  style={{
                    background: "none",
                    border: `1px solid ${colors.border}`,
                    borderRadius: 4,
                    color: colors.foregroundMuted,
                    cursor: "pointer",
                    padding: "2px 6px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <MoreHorizontal size={12} />
                </button>
                {overflowOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      background: colors.backgroundSecondary,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                      zIndex: 50,
                      minWidth: 120,
                    }}
                  >
                    {overflowChips.map((cmd) => (
                      <button
                        key={cmd.label}
                        data-testid={`tab-quick-cmd-${cmd.label}`}
                        onClick={() => {
                          setOverflowOpen(false);
                          onQuickCommand(cmd.command);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: colors.accent,
                          cursor: "pointer",
                          padding: "6px 10px",
                          fontSize: 11,
                          textAlign: "left",
                          width: "100%",
                          display: "block",
                        }}
                      >
                        {cmd.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const TabStrip = memo(TabStripComponent);

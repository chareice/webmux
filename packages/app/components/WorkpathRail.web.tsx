import { memo } from "react";
import type { Bookmark, MachineInfo } from "@webmux/shared";
import { colors } from "@/lib/colors";

export interface RailWorkpath {
  bookmark: Bookmark;
  tag: string;
  terminalCount: number;
  hasLive: boolean;
}

interface WorkpathRailProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  selectedWorkpathId: string | "all";
  workpaths: RailWorkpath[];
  totalTerminalCount: number;
  onSelectMachine: (id: string) => void;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onAddBookmark: () => void;
  onOpenSettings: () => void;
  onExpandHoverEnter: () => void;
  onExpandHoverLeave: () => void;
}

function WorkpathRailComponent(props: WorkpathRailProps) {
  const {
    machines,
    activeMachineId,
    selectedWorkpathId,
    workpaths,
    totalTerminalCount,
    onSelectMachine,
    onSelectAll,
    onSelectWorkpath,
    onAddBookmark,
    onOpenSettings,
    onExpandHoverEnter,
    onExpandHoverLeave,
  } = props;

  const machineBadgeText = (m: MachineInfo) =>
    m.name.length <= 5 ? m.name : m.name.slice(0, 2).toLowerCase();

  return (
    <div
      data-testid="workpath-rail"
      onPointerEnter={onExpandHoverEnter}
      onPointerLeave={onExpandHoverLeave}
      style={{
        width: 56,
        minWidth: 56,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        paddingTop: 8,
        paddingBottom: 8,
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Machine badges */}
      {machines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingInline: 8 }}>
          {machines.map((m) => {
            const selected = m.id === activeMachineId;
            return (
              <button
                key={m.id}
                data-testid={`rail-machine-${m.id}`}
                onClick={() => onSelectMachine(m.id)}
                title={m.name}
                style={{
                  background: selected ? colors.accent : colors.backgroundSecondary,
                  color: selected ? colors.background : colors.accent,
                  border: "none",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 0",
                  cursor: "pointer",
                }}
              >
                {machineBadgeText(m)}
              </button>
            );
          })}
          <div style={{ height: 1, background: colors.border, marginBlock: 6 }} />
        </div>
      )}

      {/* All pill */}
      <button
        data-testid="rail-pill-all"
        onClick={onSelectAll}
        style={{
          ...pillBase,
          background: selectedWorkpathId === "all" ? pillSelectedBg : "transparent",
          borderLeft: selectedWorkpathId === "all"
            ? `2px solid ${colors.accent}`
            : "2px solid transparent",
          color: selectedWorkpathId === "all" ? colors.accent : colors.foreground,
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 0.5 }}>All</div>
        {totalTerminalCount > 0 && (
          <div style={{ fontSize: 9, color: colors.foregroundMuted }}>
            {totalTerminalCount}
          </div>
        )}
      </button>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {workpaths.map((wp) => {
          const selected = selectedWorkpathId === wp.bookmark.id;
          return (
            <button
              key={wp.bookmark.id}
              data-testid={`rail-pill-${wp.bookmark.id}`}
              onClick={() => onSelectWorkpath(wp.bookmark.id)}
              title={wp.bookmark.label}
              style={{
                ...pillBase,
                background: selected ? pillSelectedBg : "transparent",
                borderLeft: selected
                  ? `2px solid ${colors.accent}`
                  : "2px solid transparent",
                color: selected ? colors.accent : colors.foreground,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: selected ? 700 : 500 }}>
                {wp.tag}
              </div>
              {wp.terminalCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 3,
                    justifyContent: "center",
                    alignItems: "center",
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: wp.hasLive
                        ? colors.accent
                        : colors.foregroundMuted,
                    }}
                  />
                  <span style={{ fontSize: 9, color: colors.foregroundMuted }}>
                    {wp.terminalCount}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, paddingTop: 6 }}>
        <button
          data-testid="rail-add-bookmark"
          onClick={onAddBookmark}
          title="Add directory"
          style={iconBtn}
        >
          +
        </button>
        <button
          data-testid="rail-open-settings"
          onClick={onOpenSettings}
          title="Settings"
          style={iconBtn}
        >
          &#9881;
        </button>
      </div>
    </div>
  );
}

const pillBase: React.CSSProperties = {
  paddingBlock: 8,
  paddingInline: 6,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "center",
  width: "100%",
};

const pillSelectedBg = "rgba(217, 119, 87, 0.08)"; // translucent terracotta

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#87867f",
  fontSize: 14,
  cursor: "pointer",
  padding: 4,
  lineHeight: 1,
};

export const WorkpathRail = memo(WorkpathRailComponent);

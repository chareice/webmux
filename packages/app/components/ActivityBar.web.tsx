import { memo } from "react";
import type { MachineInfo } from "@webmux/shared";
import { Plus, Settings } from "lucide-react";
import { colors } from "@/lib/colors";

interface ActivityBarProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  onSelectMachine: (id: string) => void;
  onAddBookmark: () => void;
  onOpenSettings: () => void;
}

// Visible only with multiple machines. Single-machine users get the global
// actions in the WorkpathPanel footer instead — see WorkpathPanel for the
// fallback rendering.
function ActivityBarComponent(props: ActivityBarProps) {
  const { machines, activeMachineId, onSelectMachine, onAddBookmark, onOpenSettings } = props;
  if (machines.length <= 1) return null;

  const machineBadgeText = (m: MachineInfo) =>
    m.name.length <= 5 ? m.name : m.name.slice(0, 2).toLowerCase();

  return (
    <div
      data-testid="activity-bar"
      style={{
        width: 48,
        minWidth: 48,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        paddingTop: 8,
        paddingBottom: 8,
        height: "100%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingInline: 8 }}>
        {machines.map((m) => {
          const selected = m.id === activeMachineId;
          return (
            <button
              key={m.id}
              data-testid={`activity-bar-machine-${m.id}`}
              onClick={() => onSelectMachine(m.id)}
              title={m.name}
              style={{
                background: selected ? colors.accent : colors.backgroundSecondary,
                color: selected ? colors.background : colors.accent,
                border: "none",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              {machineBadgeText(m)}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          paddingTop: 8,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <button
          data-testid="activity-bar-add-directory"
          onClick={onAddBookmark}
          title="Add directory"
          style={iconBtn}
          aria-label="Add directory"
        >
          <Plus size={14} />
        </button>
        <button
          data-testid="activity-bar-open-settings"
          onClick={onOpenSettings}
          title="Settings"
          style={iconBtn}
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: colors.foregroundMuted,
  cursor: "pointer",
  padding: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const ActivityBar = memo(ActivityBarComponent);

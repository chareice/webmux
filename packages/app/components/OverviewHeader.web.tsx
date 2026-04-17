import { memo } from "react";
import type { MachineInfo, ResourceStats } from "@webmux/shared";
import { Plus } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";

interface OverviewHeaderProps {
  machine: MachineInfo | null;
  stats?: ResourceStats;
  terminalCount: number;
  isController: boolean;
  canCreateTerminal: boolean;
  scopeLabel: string; // "All" or workpath label
  onRequestControl?: () => void;
  onReleaseControl?: () => void;
  onNewTerminal?: () => void;
  isMobile: boolean;
}

function OverviewHeaderComponent({
  machine,
  stats,
  terminalCount,
  isController,
  canCreateTerminal,
  scopeLabel,
  onRequestControl,
  onReleaseControl,
  onNewTerminal,
  isMobile,
}: OverviewHeaderProps) {
  const controlCopy = getTerminalControlCopy(isController);

  if (!machine) return null;

  return (
    <section
      data-testid="overview-header"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 16,
        padding: isMobile ? "14px 16px" : "16px 18px",
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: `linear-gradient(135deg, ${colorAlpha.surfaceOpaque94} 0%, ${colorAlpha.backgroundOpaque98} 100%)`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: colors.foregroundMuted,
            marginBottom: 6,
          }}
        >
          {scopeLabel}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, color: colors.foreground }}>
            {machine.name}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              background: isController ? colorAlpha.accentLight12 : colorAlpha.warningLight12,
              border: isController ? `1px solid ${colorAlpha.accentBorder}` : `1px solid ${colorAlpha.warningBorder22}`,
              color: isController ? colors.accent : colors.warning,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isController ? colors.accent : colors.warning,
              }}
            />
            {controlCopy.modeLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          justifyContent: isMobile ? "flex-start" : "flex-end",
        }}
      >
        {stats && (
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              color: colors.foregroundSecondary,
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>CPU {Math.round(stats.cpu_percent)}%</span>
            <span>
              MEM {Math.round((stats.memory_used / Math.max(stats.memory_total, 1)) * 100)}%
            </span>
            <span>{terminalCount} terminals</span>
          </div>
        )}

        {canCreateTerminal && onNewTerminal && (
          <button
            data-testid="overview-new-terminal"
            onClick={onNewTerminal}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 999,
              color: colors.foreground,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              padding: "8px 12px",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Plus size={12} />
            New terminal
          </button>
        )}

        {onRequestControl && onReleaseControl && (
          <button
            data-testid="canvas-mode-toggle"
            onClick={() => {
              if (isController) onReleaseControl();
              else onRequestControl();
            }}
            style={{
              background: isController ? "transparent" : colors.accent,
              border: isController ? `1px solid ${colors.border}` : "none",
              borderRadius: 999,
              color: isController ? colors.foreground : colors.background,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              padding: "10px 16px",
            }}
          >
            {controlCopy.toggleLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export const OverviewHeader = memo(OverviewHeaderComponent);

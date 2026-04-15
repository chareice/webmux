import type { TerminalInfo, ResourceStats } from "@webmux/shared";
import { colors } from "@/lib/colors";

interface TerminalPreviewProps {
  terminal: TerminalInfo;
  isController: boolean;
  activeMachineName?: string;
  stats?: ResourceStats;
}

function formatMemory(stats?: ResourceStats): string {
  if (!stats || stats.memory_total === 0) {
    return "Waiting for machine stats";
  }

  const usedGb = stats.memory_used / (1024 * 1024 * 1024);
  const totalGb = stats.memory_total / (1024 * 1024 * 1024);
  return `${usedGb.toFixed(1)}G / ${totalGb.toFixed(1)}G`;
}

export function TerminalPreview({
  terminal,
  isController,
  activeMachineName,
  stats,
}: TerminalPreviewProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateRows: "1fr auto",
        background:
          "linear-gradient(180deg, rgba(var(--color-background) / 0.96) 0%, rgba(var(--color-background-secondary) / 0.96) 100%)",
      }}
    >
      <div
        style={{
          padding: "14px 16px 10px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              width: "fit-content",
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid rgba(var(--color-accent) / 0.2)",
              background: "rgba(var(--color-accent) / 0.08)",
              color: colors.accent,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.2,
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
            {isController ? "Ready to Control" : "Open to Watch"}
          </div>

          <div
            style={{
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', monospace",
              fontSize: 12,
              lineHeight: 1.7,
              color: colors.foregroundSecondary,
              whiteSpace: "pre-wrap",
            }}
          >
            {`$ ${terminal.cwd}\n# ${terminal.title}\n${isController ? "Click to expand and keep working." : "Take control to type or close this terminal."}`}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
            fontSize: 11,
            color: colors.foregroundSecondary,
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.03)",
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ color: colors.foregroundMuted, marginBottom: 4 }}>Machine</div>
            <div style={{ color: colors.foreground }}>
              {activeMachineName ?? terminal.machine_id}
            </div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.03)",
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ color: colors.foregroundMuted, marginBottom: 4 }}>Memory</div>
            <div style={{ color: colors.foreground }}>{formatMemory(stats)}</div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 16px",
          borderTop: `1px solid ${colors.border}`,
          background: "rgba(0, 0, 0, 0.18)",
          color: colors.foregroundSecondary,
          fontSize: 11,
        }}
      >
        <span>Terminal stays lightweight here to keep the grid responsive.</span>
        <span style={{ color: colors.foreground }}>Open Full View</span>
      </div>
    </div>
  );
}

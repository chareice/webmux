import type { TerminalInfo, ResourceStats } from "@webmux/shared";

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
          "linear-gradient(180deg, rgba(8, 18, 30, 0.96) 0%, rgba(13, 33, 55, 0.96) 100%)",
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
              border: "1px solid rgba(0, 212, 170, 0.2)",
              background: "rgba(0, 212, 170, 0.08)",
              color: "rgb(0, 212, 170)",
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
                background: isController ? "rgb(0, 212, 170)" : "rgb(255, 193, 7)",
              }}
            />
            {isController ? "Ready to Control" : "Open to Watch"}
          </div>

          <div
            style={{
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', monospace",
              fontSize: 12,
              lineHeight: 1.7,
              color: "rgb(122, 143, 166)",
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
            color: "rgb(122, 143, 166)",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(26, 58, 92, 0.9)",
            }}
          >
            <div style={{ color: "rgb(74, 97, 120)", marginBottom: 4 }}>Machine</div>
            <div style={{ color: "rgb(224, 232, 240)" }}>
              {activeMachineName ?? terminal.machine_id}
            </div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(26, 58, 92, 0.9)",
            }}
          >
            <div style={{ color: "rgb(74, 97, 120)", marginBottom: 4 }}>Memory</div>
            <div style={{ color: "rgb(224, 232, 240)" }}>{formatMemory(stats)}</div>
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
          borderTop: "1px solid rgba(26, 58, 92, 0.9)",
          background: "rgba(0, 0, 0, 0.18)",
          color: "rgb(122, 143, 166)",
          fontSize: 11,
        }}
      >
        <span>Terminal stays lightweight here to keep the grid responsive.</span>
        <span style={{ color: "rgb(224, 232, 240)" }}>Open Full View</span>
      </div>
    </div>
  );
}

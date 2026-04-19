// Minimal 24px status bar (design-refresh).
// Monospace readout at the bottom of the workbench — hidden by default,
// toggleable from Settings. Reads hostname + active stats + control state.
//
// Deliberately muted: no brand-colour fill, only accent on the "Controlling"
// marker at the far right.
import { memo } from "react";
import { colors } from "@/lib/colors";
import { UpdateNotification } from "./UpdateNotification";
function formatBytes(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1)
        return `${gb.toFixed(1)}G`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)}M`;
}
function totalDiskPercent(disks) {
    if (disks.length === 0)
        return 0;
    let used = 0;
    let total = 0;
    for (const d of disks) {
        used += d.used_bytes;
        total += d.total_bytes;
    }
    if (total === 0)
        return 0;
    return (used / total) * 100;
}
function StatusBarComponent(props) {
    const { machines, activeMachineId, machineStats, isMobile, isController, } = props;
    const active = machines.find((m) => m.id === activeMachineId);
    const stats = activeMachineId ? machineStats[activeMachineId] : undefined;
    const disk = stats ? Math.round(totalDiskPercent(stats.disks)) : null;
    const cpu = stats ? Math.round(stats.cpu_percent) : null;
    const memUsed = stats ? formatBytes(stats.memory_used) : null;
    const memTotal = stats ? formatBytes(stats.memory_total) : null;
    const compact = isMobile;
    return (<div data-testid="status-bar" style={{
            height: 24,
            minHeight: 24,
            maxHeight: 24,
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg1,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 14,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: colors.fg2,
            overflow: "hidden",
            flexShrink: 0,
            userSelect: "none",
        }}>
      <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
        }}>
        <span style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: isController ? colors.accent : colors.fg3,
        }}/>
        <span style={{ color: colors.fg1 }}>{active?.name ?? "—"}</span>
      </span>
      {cpu !== null && (<span style={{ flexShrink: 0 }}>
          <span style={{ color: colors.fg3 }}>CPU </span>
          {cpu}%
        </span>)}
      {memUsed && memTotal && (<span style={{ flexShrink: 0 }}>
          <span style={{ color: colors.fg3 }}>MEM </span>
          {memUsed}/{memTotal}
        </span>)}
      {!compact && disk !== null && (<span style={{ flexShrink: 0 }}>
          <span style={{ color: colors.fg3 }}>DISK </span>
          {disk}%
        </span>)}
      <div style={{ flex: 1 }}/>
      <UpdateNotification />
      <span style={{
            color: isController ? colors.accent : colors.fg3,
            flexShrink: 0,
        }}>
        ● {isController ? "Controlling" : "View only"}
      </span>
    </div>);
}
export const StatusBar = memo(StatusBarComponent);

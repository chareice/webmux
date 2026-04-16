import { memo, useState, useEffect, useRef, useCallback } from "react";
import type { MachineInfo, ResourceStats } from "@webmux/shared";
import { getStatusBarLayout } from "./statusBarLayout";
import { getTerminalControlCopy } from "@/lib/terminalViewModel";
import { colors, colorAlpha } from "@/lib/colors";
import { UpdateNotification } from "./UpdateNotification";

interface StatusBarProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  onSelectMachine: (id: string) => void;
  machineStats: Record<string, ResourceStats>;
  isMobile: boolean;
  isController: boolean;
  onRequestControl: (machineId: string) => void;
  onReleaseControl: (machineId: string) => void;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)}G`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}M`;
}

function percentColor(pct: number): string {
  if (pct >= 85) return colors.danger;
  if (pct >= 60) return colors.warning;
  return colors.success;
}

function totalDiskPercent(disks: ResourceStats["disks"]): number {
  if (disks.length === 0) return 0;
  let totalUsed = 0;
  let totalSize = 0;
  for (const d of disks) {
    totalUsed += d.used_bytes;
    totalSize += d.total_bytes;
  }
  if (totalSize === 0) return 0;
  return (totalUsed / totalSize) * 100;
}

function formatStatValue(
  stat: "cpu" | "memory" | "disk",
  values: {
    cpuPct: number | null;
    memPct: number | null;
    diskPct: number | null;
    stats: ResourceStats;
    isMobile: boolean;
  },
): string {
  switch (stat) {
    case "cpu":
      return `${values.cpuPct ?? 0}%`;
    case "memory":
      if (values.isMobile) {
        return `${Math.round(values.memPct ?? 0)}%`;
      }
      return `${formatBytes(values.stats.memory_used)}/${formatBytes(values.stats.memory_total)}`;
    case "disk":
      return `${Math.round(values.diskPct ?? 0)}%`;
  }
}


function StatusBarComponent({
  machines,
  activeMachineId,
  onSelectMachine,
  machineStats,
  isMobile,
  isController,
  onRequestControl,
  onReleaseControl,
}: StatusBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const activeMachine = machines.find((m) => m.id === activeMachineId);
  const stats = activeMachineId ? machineStats[activeMachineId] : undefined;
  const layout = getStatusBarLayout(isMobile);

  const handleMachineClick = useCallback(() => {
    if (machines.length > 1) {
      setDropdownOpen((prev) => !prev);
    }
  }, [machines.length]);

  const handleSelectMachine = useCallback(
    (id: string) => {
      onSelectMachine(id);
      setDropdownOpen(false);
    },
    [onSelectMachine],
  );

  const cpuPct = stats ? Math.round(stats.cpu_percent) : null;
  const memPct =
    stats && stats.memory_total > 0
      ? (stats.memory_used / stats.memory_total) * 100
      : null;
  const diskPct = stats ? totalDiskPercent(stats.disks) : null;
  const canToggleMode = Boolean(activeMachineId);
  const controlCopy = getTerminalControlCopy(isController);
  const statLabels = {
    cpu: "CPU",
    memory: isMobile ? "MEM" : "MEM",
    disk: "DISK",
  } as const;

  return (
    <div
      style={{
        height: 24,
        minHeight: 24,
        maxHeight: 24,
        background: colors.accent,
        color: colors.foreground,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: "none",
        paddingLeft: 8,
        paddingRight: 8,
        position: "relative",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* Left side */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, minWidth: 0, flex: 1, overflow: "hidden" }}>
        {/* Machine selector */}
        <div ref={dropdownRef} style={{ position: "relative", minWidth: 0, maxWidth: "100%" }}>
          <button
            onClick={handleMachineClick}
            style={{
              background: "none",
              border: "none",
              color: colors.foreground,
              cursor: machines.length > 1 ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: layout.machineButtonPadding,
              height: 24,
              fontSize: 12,
              fontFamily: "inherit",
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: colors.success,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeMachine?.name ?? "No machine"}
            </span>
            {!isMobile && machines.length > 1 && (
              <span style={{ fontSize: 8, marginLeft: 2 }}>&#9650;</span>
            )}
          </button>

          {/* Dropdown */}
          {dropdownOpen && machines.length > 1 && (
            <div
              style={{
                position: "absolute",
                bottom: 24,
                left: 0,
                background: colors.backgroundSecondary,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                minWidth: 160,
                zIndex: 1000,
                boxShadow: `0 -4px 12px ${colorAlpha.backgroundShadow}`,
              }}
            >
              {machines.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleSelectMachine(m.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "6px 10px",
                    background:
                      m.id === activeMachineId
                        ? colors.surface
                        : "transparent",
                    border: "none",
                    color: colors.foreground,
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: colors.success,
                      flexShrink: 0,
                    }}
                  />
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Separator + stats */}
        {layout.showStats && stats && (
          <>
            <span
              style={{
                width: 1,
                height: 14,
                background: colorAlpha.foregroundSubtle,
                margin: layout.separatorMargin,
                flexShrink: 0,
              }}
            />
            {layout.visibleStats.map((stat) => {
              const pct =
                stat === "cpu"
                  ? cpuPct ?? 0
                  : stat === "memory"
                    ? memPct ?? 0
                    : diskPct ?? 0;

              return (
                <span
                  key={stat}
                  data-testid={`statusbar-stat-${stat}`}
                  style={{ padding: layout.statPadding, whiteSpace: "nowrap" }}
                >
                  <span style={{ opacity: 0.8 }}>{statLabels[stat]} </span>
                  <span
                    style={{
                      color: percentColor(pct),
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatStatValue(stat, {
                      cpuPct,
                      memPct,
                      diskPct,
                      stats,
                      isMobile,
                    })}
                  </span>
                </span>
              );
            })}
          </>
        )}
      </div>

      {/* Right side — renderer switch + mode toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: layout.sectionGap, flexShrink: 0, marginLeft: 8 }}>
        <UpdateNotification />
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isController ? colors.success : colors.foregroundMuted,
            flexShrink: 0,
          }}
        />
        {layout.showModeLabel && (
          <span style={{ opacity: 0.9 }}>
            {controlCopy.modeLabel}
          </span>
        )}
        <button
          data-testid="statusbar-mode-toggle"
          onClick={() => {
            if (!activeMachineId) return;
            if (isController) onReleaseControl(activeMachineId);
            else onRequestControl(activeMachineId);
          }}
          style={{
            background: colorAlpha.foregroundOverlay,
            border: "none",
            borderRadius: 3,
            color: colors.foreground,
            cursor: canToggleMode ? "pointer" : "not-allowed",
            opacity: canToggleMode ? 1 : 0.5,
            padding: layout.actionButtonPadding,
            fontSize: 11,
            fontFamily: "inherit",
            lineHeight: "18px",
          }}
          disabled={!canToggleMode}
        >
          {controlCopy.toggleLabel}
        </button>
      </div>
    </div>
  );
}

export const StatusBar = memo(StatusBarComponent);

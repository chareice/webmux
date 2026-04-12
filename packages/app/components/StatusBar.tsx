import { memo, useState, useEffect, useRef, useCallback } from "react";
import type { MachineInfo, ResourceStats } from "@webmux/shared";
import { getStatusBarLayout } from "./statusBarLayout";

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
  if (pct >= 85) return "rgb(255, 82, 82)";
  if (pct >= 60) return "rgb(255, 193, 7)";
  return "rgb(0, 212, 170)";
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

  return (
    <div
      style={{
        height: 24,
        minHeight: 24,
        maxHeight: 24,
        background: "rgb(0, 122, 204)",
        color: "#fff",
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
              color: "#fff",
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
                background: "rgb(0, 212, 170)",
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
                background: "rgb(30, 30, 30)",
                border: "1px solid rgb(60, 60, 60)",
                borderRadius: 4,
                minWidth: 160,
                zIndex: 1000,
                boxShadow: "0 -4px 12px rgba(0,0,0,0.4)",
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
                        ? "rgb(4, 57, 94)"
                        : "transparent",
                    border: "none",
                    color: "#fff",
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
                      background: "rgb(0, 212, 170)",
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
                background: "rgba(255,255,255,0.35)",
                margin: "0 6px",
                flexShrink: 0,
              }}
            />
            {/* CPU */}
            <span style={{ padding: "0 4px", whiteSpace: "nowrap" }}>
              <span style={{ opacity: 0.8 }}>CPU </span>
              <span style={{ color: percentColor(cpuPct ?? 0), fontVariantNumeric: "tabular-nums" }}>
                {cpuPct ?? 0}%
              </span>
            </span>
            {/* MEM */}
            <span style={{ padding: "0 4px", whiteSpace: "nowrap" }}>
              <span style={{ opacity: 0.8 }}>MEM </span>
              <span style={{ color: percentColor(memPct ?? 0), fontVariantNumeric: "tabular-nums" }}>
                {formatBytes(stats.memory_used)}/{formatBytes(stats.memory_total)}
              </span>
            </span>
            {/* DISK */}
            <span style={{ padding: "0 4px", whiteSpace: "nowrap" }}>
              <span style={{ opacity: 0.8 }}>DISK </span>
              <span style={{ color: percentColor(diskPct ?? 0), fontVariantNumeric: "tabular-nums" }}>
                {Math.round(diskPct ?? 0)}%
              </span>
            </span>
          </>
        )}
      </div>

      {/* Right side — mode toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: layout.sectionGap, flexShrink: 0, marginLeft: 8 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: isController ? "rgb(0, 212, 170)" : "rgb(120, 120, 120)",
            flexShrink: 0,
          }}
        />
        {layout.showModeLabel && (
          <span style={{ opacity: 0.9 }}>
            {isController ? "Control" : "Watch"}
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
            background: "rgba(255,255,255,0.15)",
            border: "none",
            borderRadius: 3,
            color: "#fff",
            cursor: canToggleMode ? "pointer" : "not-allowed",
            opacity: canToggleMode ? 1 : 0.5,
            padding: layout.actionButtonPadding,
            fontSize: 11,
            fontFamily: "inherit",
            lineHeight: "18px",
          }}
          disabled={!canToggleMode}
        >
          {isController ? "Release" : "Take Control"}
        </button>
      </div>
    </div>
  );
}

export const StatusBar = memo(StatusBarComponent);

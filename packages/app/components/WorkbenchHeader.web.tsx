// Workbench header (design-refresh).
// Replaces OverviewHeader + TabStrip with a single responsive row:
//   [rail-toggle?] breadcrumb | Controlling pill | CPU/MEM/TERM chips
//   | New terminal (⌘N) | Stop Control
// Below ~1180px it collapses to two rows (stats + controlling on row 1,
// actions on row 2). Below ~820px the stat sparklines disappear and
// button labels drop to icons-only.

import { memo, useMemo } from "react";
import type { ResourceStats } from "@webmux/shared";
import { Plus, Square } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";

interface WorkbenchHeaderProps {
  scopeLabel: string; // "All" or a workpath label
  hostName: string;
  isController: boolean;
  terminalCount: number;
  stats: ResourceStats | undefined;
  viewportWidth: number;
  canCreateTerminal: boolean;
  railOpen: boolean;
  onOpenRail: () => void;
  onNewTerminal?: () => void;
  onReleaseControl?: () => void;
  onRequestControl?: () => void;
}

function WorkbenchHeaderComponent(props: WorkbenchHeaderProps) {
  const {
    scopeLabel,
    hostName,
    isController,
    terminalCount,
    stats,
    viewportWidth,
    canCreateTerminal,
    railOpen,
    onOpenRail,
    onNewTerminal,
    onReleaseControl,
    onRequestControl,
  } = props;

  const compact = viewportWidth < 1180;
  const tight = viewportWidth < 820;

  return (
    <header
      data-testid="workbench-header"
      style={{
        display: "flex",
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
        padding: compact ? "8px 12px" : "10px 16px",
        borderBottom: `1px solid ${colors.lineSoft}`,
        gap: compact ? 8 : 12,
        background: colors.bg0,
        flexShrink: 0,
      }}
    >
      {/* Row 1: breadcrumb + Controlling + (desktop) stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
          flex: compact ? "0 0 auto" : "initial",
        }}
      >
        {!railOpen && (
          <button
            onClick={onOpenRail}
            title="Open sidebar"
            aria-label="Open sidebar"
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.fg2,
              background: "none",
              border: "none",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Chevron right size={14} />
          </button>
        )}

        <Breadcrumb host={hostName} scope={scopeLabel} />

        {!tight && (
          <span
            style={{ height: 18, width: 1, background: colors.line, flexShrink: 0 }}
          />
        )}
        {!tight && <ControllingPill isController={isController} />}

        {compact && <div style={{ flex: 1 }} />}
        {compact && (
          <StatChips stats={stats} terminals={terminalCount} compact />
        )}
      </div>

      {!compact && <div style={{ flex: 1 }} />}
      {!compact && <StatChips stats={stats} terminals={terminalCount} />}
      {!compact && (
        <span
          style={{ height: 22, width: 1, background: colors.line, flexShrink: 0 }}
        />
      )}

      {/* Row 2 on compact: actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: compact ? "space-between" : "flex-end",
        }}
      >
        {tight && <ControllingPill isController={isController} />}
        <div style={{ flex: compact ? 0 : "initial" }} />

        {canCreateTerminal && onNewTerminal && (
          <button
            data-testid="workbench-new-terminal"
            onClick={onNewTerminal}
            title="New terminal"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: tight ? "6px 9px" : "6px 10px 6px 9px",
              borderRadius: 7,
              background: colors.bg2,
              border: `1px solid ${colors.line}`,
              color: colors.fg0,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            <Plus size={12} />
            {!tight && <span>New terminal</span>}
            {!compact && <Kbd>⌘N</Kbd>}
          </button>
        )}

        {isController && onReleaseControl ? (
          <button
            data-testid="workbench-stop-control"
            onClick={onReleaseControl}
            title="Stop Control"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: tight ? "6px 9px" : "6px 10px",
              borderRadius: 7,
              background: colorAlpha.dangerSoft,
              border: `1px solid ${colorAlpha.dangerLine}`,
              color: colors.err,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            <Square size={11} fill="currentColor" />
            {!tight && <span>Stop{!compact && " Control"}</span>}
          </button>
        ) : onRequestControl ? (
          <button
            data-testid="workbench-request-control"
            onClick={onRequestControl}
            title="Request control"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: tight ? "6px 9px" : "6px 10px",
              borderRadius: 7,
              background: colorAlpha.accentSoft,
              border: `1px solid ${colorAlpha.accentLine}`,
              color: colors.accent,
              fontSize: 12,
              fontWeight: 500,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            {tight ? "Ctrl" : "Request control"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

export const WorkbenchHeader = memo(WorkbenchHeaderComponent);

/* ---------- Subcomponents ---------- */

function Breadcrumb({ host, scope }: { host: string; scope: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
      }}
    >
      <span
        style={{ color: colors.fg3, fontSize: 12, whiteSpace: "nowrap" }}
      >
        {host}
      </span>
      <span style={{ color: colors.fg3 }}>/</span>
      <span
        style={{
          fontWeight: 600,
          color: colors.fg0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {scope}
      </span>
    </div>
  );
}

function ControllingPill({ isController }: { isController: boolean }) {
  if (isController) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px 3px 6px",
          borderRadius: 999,
          background: colorAlpha.accentSoft,
          color: colors.accent,
          fontSize: 11,
          fontWeight: 600,
          border: `1px solid ${colorAlpha.accentLine}`,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: colors.accent,
            boxShadow: `0 0 0 3px rgba(251, 157, 89, 0.22)`,
          }}
        />
        Controlling
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 6px",
        borderRadius: 999,
        background: colorAlpha.mutedLight,
        color: colors.fg2,
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${colors.line}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: colors.fg2,
        }}
      />
      View only
    </span>
  );
}

function StatChips({
  stats,
  terminals,
  compact,
}: {
  stats: ResourceStats | undefined;
  terminals: number;
  compact?: boolean;
}) {
  const cpu = stats ? Math.round(stats.cpu_percent) : 0;
  const mem =
    stats && stats.memory_total > 0
      ? Math.round((stats.memory_used / stats.memory_total) * 100)
      : 0;
  const cpuSeries = useMemo(() => mockSeries(3 + cpu, 20, 0.05, 0.35), [cpu]);
  const memSeries = useMemo(() => mockSeries(7 + mem, 20, 0.18, 0.32), [mem]);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 10 : 14,
        color: colors.fg2,
      }}
    >
      <StatChip
        label="CPU"
        value={`${cpu}%`}
        series={compact ? null : cpuSeries}
      />
      <StatChip
        label="MEM"
        value={`${mem}%`}
        series={compact ? null : memSeries}
      />
      {!compact && (
        <StatChip label="TERM" value={String(terminals)} series={null} />
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  series,
}: {
  label: string;
  value: string;
  series: number[] | null;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        fontFamily: "ui-monospace, Cascadia Code, Menlo, monospace",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: colors.fg3 }}>{label}</span>
      <span style={{ color: colors.fg0, fontWeight: 600 }}>{value}</span>
      {series && (
        <Sparkline
          data={series}
          width={44}
          height={14}
          color={colors.fg2}
          fill="rgba(144, 146, 151, 0.12)"
        />
      )}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "ui-monospace, Cascadia Code, Menlo, monospace",
        fontSize: 10,
        color: colors.fg3,
        border: `1px solid ${colors.line}`,
        borderRadius: 4,
        padding: "0 4px",
        marginLeft: 2,
      }}
    >
      {children}
    </kbd>
  );
}

function Chevron({ right, size = 14 }: { right?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      <polyline
        points={right ? "9 6 15 12 9 18" : "15 6 9 12 15 18"}
      />
    </svg>
  );
}

/* ---------- Small sparkline + deterministic mock series ---------- */

export function Sparkline({
  data,
  width = 64,
  height = 18,
  color = "currentColor",
  fill,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const step = width / (data.length - 1 || 1);
  const pts = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / (max - min || 1)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const fillPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
    >
      {fill && <polygon points={fillPts} fill={fill} />}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Deterministic pseudo-series — used for sparklines when we don't yet have
// a real history from the backend. Same formula as the design bundle so the
// visual texture matches.
export function mockSeries(seed: number, n = 24, floor = 0.1, ceil = 0.9) {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.sin(x * 9301 + 49297) + 1) / 2;
    out.push(floor + x * (ceil - floor));
  }
  return out;
}

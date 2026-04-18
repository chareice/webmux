// Terminal grid card (design-refresh).
// Rendered by Workbench.web — one card per terminal in the currently scoped
// workpath (or all terminals for the active host in the "All" scope).
//
// Visual structure (top → bottom):
//   header:  tint dot · title · short id chip · [ctrl] · expand · close
//   body:    scaled-down live xterm preview (pointer-events disabled)
//   footer:  cwd (~-shortened) + optional workpath tag
//
// Click anywhere on the card → onExpand(terminal.id). The close button
// stops propagation so it doesn't also expand.

import { lazy, memo, Suspense, useState } from "react";
import type { TerminalInfo } from "@webmux/shared";
import { Expand, MoreHorizontal, X } from "lucide-react";
import { terminalWsUrl } from "@/lib/api";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";

const LiveTerminalView = lazy(() =>
  import("./TerminalView.web").then((module) => ({
    default: module.TerminalView,
  })),
);

interface TerminalGridCardProps {
  terminal: TerminalInfo;
  isController: boolean;
  deviceId: string;
  workpathLabel?: string;
  onExpand: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
}

function TerminalGridCardComponent(props: TerminalGridCardProps) {
  const {
    terminal,
    isController,
    deviceId,
    workpathLabel,
    onExpand,
    onDestroy,
  } = props;
  const [hover, setHover] = useState(false);
  const short = terminal.id.slice(0, 8);
  const tintColor = tintForId(terminal.id);
  const wsUrl = terminal.reachable
    ? terminalWsUrl(terminal.machine_id, terminal.id, deviceId)
    : null;

  return (
    <div
      data-testid={`grid-card-${terminal.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onExpand(terminal.id)}
      style={{
        background: colors.bg1,
        border: `1px solid ${hover ? colors.line : colors.lineSoft}`,
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        transition: "border-color 120ms, box-shadow 120ms",
        cursor: "pointer",
        boxShadow: hover ? "0 6px 20px -12px black" : "none",
      }}
    >
      {!terminal.reachable && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.6)",
            zIndex: 5,
          }}
        >
          <span style={{ color: colors.fg1, fontSize: 12 }}>
            Waiting for reconnection…
          </span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderBottom: `1px solid ${colors.lineSoft}`,
          background: colors.bg1,
          minWidth: 0,
        }}
      >
        <TintDot color={tintColor} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.fg0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
          }}
        >
          {terminal.title || short}
        </span>
        <span
          style={{
            fontFamily: "ui-monospace, Cascadia Code, Menlo, monospace",
            fontSize: 10.5,
            color: colors.fg3,
            padding: "1px 6px",
            borderRadius: 4,
            background: colors.bg2,
            flexShrink: 0,
          }}
        >
          {short}
        </span>
        {isController && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 4,
              background: colorAlpha.accentSoft,
              color: colors.accent,
              border: `1px solid ${colorAlpha.accentLine}`,
              flexShrink: 0,
            }}
          >
            ctrl
          </span>
        )}
        <div
          style={{
            display: "flex",
            gap: 2,
            opacity: hover ? 1 : 0.45,
            transition: "opacity 120ms",
            flexShrink: 0,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpand(terminal.id);
            }}
            title="Expand"
            aria-label="Expand terminal"
            style={iconBtn}
          >
            <Expand size={12} />
          </button>
          <button
            onClick={(e) => e.stopPropagation()}
            title="More"
            aria-label="More actions"
            style={iconBtn}
          >
            <MoreHorizontal size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isController) return;
              onDestroy(terminal);
            }}
            title={isController ? "Close" : "View only — cannot close"}
            aria-label="Close terminal"
            disabled={!isController}
            style={{
              ...iconBtn,
              color: isController ? colors.fg2 : colors.fg3,
              cursor: isController ? "pointer" : "not-allowed",
            }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Body — scaled-down live preview */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: terminalTheme.background,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {terminal.reachable && wsUrl && (
          <Suspense fallback={null}>
            <div
              style={{
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              <LiveTerminalView
                machineId={terminal.machine_id}
                terminalId={terminal.id}
                wsUrl={wsUrl}
                cols={terminal.cols}
                rows={terminal.rows}
                displayMode="card"
                isController={isController}
                canResizeTerminal={false}
                style={{
                  transform: "scale(0.35)",
                  transformOrigin: "top left",
                  width: "286%",
                  height: "286%",
                }}
              />
            </div>
          </Suspense>
        )}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 14,
            background:
              "linear-gradient(rgba(5,6,10,1), rgba(5,6,10,0))",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "ui-monospace, Cascadia Code, Menlo, monospace",
          fontSize: 10.5,
          color: colors.fg3,
          borderTop: `1px solid ${colors.lineSoft}`,
          background: colors.bg1,
        }}
      >
        <span
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
        >
          {shortenHome(terminal.cwd)}
        </span>
        {workpathLabel && (
          <span style={{ color: colors.fg2, flexShrink: 0 }}>
            {workpathLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export const TerminalGridCard = memo(TerminalGridCardComponent);

/* ---------- helpers ---------- */

const iconBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: colors.fg2,
  background: "none",
  border: "none",
  cursor: "pointer",
};

function TintDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 0 3px ${color}33`,
        flexShrink: 0,
      }}
    />
  );
}

const TINT_PALETTE = [
  "#fb9d59", // amber
  "#bb9af4", // violet
  "#69c1fc", // blue
  "#63d18f", // green
  "#ef7f7a", // rose
];

function tintForId(id: string): string {
  // Deterministic pick — same terminal always gets the same tint.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % TINT_PALETTE.length;
  return TINT_PALETTE[idx];
}

function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}

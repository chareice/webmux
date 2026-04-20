// Expanded terminal overlay (design-refresh).
// A fullscreen-ish modal showing the focused terminal at full xterm size,
// with a thumbnail strip of sibling terminals at the bottom that lets the
// user jump between them without leaving focus.
//
// Interactions:
// - Escape: close the overlay (unless focus is inside the terminal, which
//   needs Esc for its own keybindings — xterm swallows it there).
// - Click on the dim backdrop: close.
// - Click a sibling thumbnail: switch the focused terminal.
//
// This reuses the existing TerminalCard in "tab" display mode so all the
// real-terminal plumbing (xterm, resize-to-container, controller gating,
// mobile key bar, close handling) is unchanged — only the chrome wrapping
// it is new.

import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalInfo } from "@webmux/shared";
import { Expand, RefreshCw, X } from "lucide-react";
import { TerminalCard, type TerminalCardRef } from "./TerminalCard.web";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
import { terminalWsUrl } from "@/lib/api";

const LiveTerminalView = lazy(() =>
  import("./TerminalView.web").then((module) => ({
    default: module.TerminalView,
  })),
);

interface ExpandedTerminalProps {
  terminal: TerminalInfo;
  siblings: TerminalInfo[];
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

function ExpandedTerminalComponent(props: ExpandedTerminalProps) {
  const {
    terminal,
    siblings,
    isController,
    deviceId,
    isMobile,
    onClose,
    onPick,
    onDestroy,
    onRequestControl,
    onReleaseControl,
  } = props;
  const cardRef = useRef<TerminalCardRef>(null);
  const short = terminal.id.slice(0, 8);
  const tintColor = tintForId(terminal.id);

  // Keep focus inside the terminal body so typing goes to the PTY.
  useEffect(() => {
    const id = requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [terminal.id]);

  // Arrow-key navigation between siblings (works when the overlay is open
  // but the terminal body isn't focused — e.g. the header was just clicked).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest(".xterm")) {
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        const idx = siblings.findIndex((s) => s.id === terminal.id);
        const prev = siblings[idx - 1];
        if (prev) onPick(prev.id);
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        const idx = siblings.findIndex((s) => s.id === terminal.id);
        const next = siblings[idx + 1];
        if (next) onPick(next.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [siblings, terminal.id, onPick]);

  return (
    <div
      data-testid="expanded-terminal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: colorAlpha.overlay,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: isMobile ? 0 : 24,
        animation: "webmuxFadeIn 140ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          maxWidth: 1400,
          maxHeight: "100%",
          background: terminalTheme.background,
          border: isMobile ? "none" : `1px solid ${colors.line}`,
          borderRadius: isMobile ? 0 : 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: isMobile
            ? "none"
            : "0 40px 100px -30px black",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: `1px solid ${colors.lineSoft}`,
            background: colors.bg2,
            flexShrink: 0,
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: "flex", gap: 6 }}>
            <TrafficDot color={colors.err} />
            <TrafficDot color={colors.warn} />
            <TrafficDot color={colors.ok} />
          </div>
          <span style={{ color: colors.fg3 }}>·</span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: tintColor,
              boxShadow: `0 0 0 3px ${tintColor}33`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: colors.fg0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {terminal.title || short}
          </span>
          <span
            style={{
              fontFamily:
                "var(--font-mono)",
              fontSize: 11,
              color: colors.fg3,
            }}
          >
            {short}
          </span>
          <span style={{ color: colors.fg3 }}>·</span>
          <span
            style={{
              fontFamily:
                "var(--font-mono)",
              fontSize: 11,
              color: colors.fg2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {shortenHome(terminal.cwd)}
          </span>
          {isController && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "1px 7px",
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
          <div style={{ flex: 1 }} />

          <button
            onClick={() => cardRef.current?.fitToContainer()}
            title="Re-fit terminal"
            aria-label="Re-fit terminal"
            style={iconBtn}
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => cardRef.current?.fitToContainer()}
            title="Fit"
            aria-label="Fit"
            style={iconBtn}
          >
            <Expand size={13} />
          </button>
          <button
            onClick={onClose}
            title="Collapse (Esc)"
            aria-label="Collapse"
            style={{ ...iconBtn, color: colors.fg1 }}
            data-testid="expanded-close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Terminal body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            background: terminalTheme.background,
            display: "flex",
          }}
        >
          <TerminalCard
            ref={cardRef}
            terminal={terminal}
            displayMode="tab"
            isMobile={isMobile}
            isController={isController}
            deviceId={deviceId}
            onSelectTab={() => { /* unused in overlay */ }}
            onDestroy={onDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        </div>

        {/* Meta + sibling thumbnail strip */}
        <div
          style={{
            padding: "10px 14px",
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg1,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily:
                "var(--font-mono)",
              fontSize: 11,
              color: colors.fg3,
            }}
          >
            <span>
              id <span style={{ color: colors.fg1 }}>{short}</span>
            </span>
            <span>·</span>
            <span>
              {terminal.cols}×{terminal.rows}
            </span>
            <span>·</span>
            <span>
              {terminal.reachable ? "reachable" : "offline"}
            </span>
            <div style={{ flex: 1 }} />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <kbd
                style={{
                  fontFamily:
                    "var(--font-mono)",
                  fontSize: 10,
                  border: `1px solid ${colors.line}`,
                  borderRadius: 4,
                  padding: "0 5px",
                  color: colors.fg2,
                }}
              >
                Esc
              </kbd>
              <span>collapse</span>
            </span>
          </div>

          {siblings.length > 1 && (
            <div
              style={{
                display: "flex",
                gap: 6,
                overflowX: "auto",
                paddingBottom: 2,
              }}
            >
              {siblings.map((s) => (
                <SiblingThumb
                  key={s.id}
                  sibling={s}
                  isActive={s.id === terminal.id}
                  isController={isController}
                  deviceId={deviceId}
                  onPick={onPick}
                  onDestroy={onDestroy}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ExpandedTerminal = memo(ExpandedTerminalComponent);

/* ---------- sibling thumb ---------- */

interface SiblingThumbProps {
  sibling: TerminalInfo;
  isActive: boolean;
  isController: boolean;
  deviceId: string;
  onPick: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
}

const PREVIEW_WIDTH = 420;
const PREVIEW_HEIGHT = 240;
const PREVIEW_DELAY_MS = 250;
const PREVIEW_GAP = 10;

function SiblingThumb({
  sibling,
  isActive,
  isController,
  deviceId,
  onPick,
  onDestroy,
}: SiblingThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<{ top: number; left: number } | null>(
    null,
  );

  // Delay before mounting the preview — avoids opening a WS for every thumb
  // the cursor just brushes past. The active thumb never previews (its
  // content is already the main terminal body above).
  useEffect(() => {
    if (!hover || isActive || !sibling.reachable) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const vw = window.innerWidth;
      let left = rect.left + rect.width / 2;
      // Keep within viewport horizontally (with 8px margin).
      const half = PREVIEW_WIDTH / 2;
      if (left - half < 8) left = half + 8;
      if (left + half > vw - 8) left = vw - half - 8;
      setPreview({ top: rect.top - PREVIEW_GAP, left });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hover, isActive, sibling.reachable]);

  const previewWsUrl =
    preview && sibling.reachable
      ? terminalWsUrl(sibling.machine_id, sibling.id, deviceId)
      : null;

  return (
    <div
      ref={ref}
      data-testid={`expanded-thumb-${sibling.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onPick(sibling.id)}
      style={{
        flexShrink: 0,
        width: 140,
        height: 56,
        border: isActive
          ? `1px solid ${colorAlpha.accentLine}`
          : `1px solid ${colors.lineSoft}`,
        background: isActive ? colors.bg2 : colors.bg1,
        borderRadius: 7,
        padding: 6,
        textAlign: "left",
        color: isActive ? colors.fg0 : colors.fg2,
        overflow: "hidden",
        position: "relative",
        outline: isActive ? `2px solid ${colors.accent}` : "none",
        outlineOffset: -1,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 3,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: tintForId(sibling.id),
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
          }}
        >
          {sibling.title || sibling.id.slice(0, 8)}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: colors.fg3,
          lineHeight: 1.35,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {shortenHome(sibling.cwd)}
      </div>
      {hover && (
        <button
          data-testid={`expanded-thumb-close-${sibling.id}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isController) return;
            onDestroy(sibling);
          }}
          disabled={!isController}
          title={isController ? "Close terminal" : "View only — cannot close"}
          aria-label={isController ? "Close terminal" : "View only — cannot close"}
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 18,
            height: 18,
            borderRadius: 4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: colors.bg2,
            border: `1px solid ${colors.lineSoft}`,
            color: isController ? colors.fg1 : colors.fg3,
            cursor: isController ? "pointer" : "not-allowed",
            padding: 0,
          }}
        >
          <X size={11} />
        </button>
      )}
      {preview &&
        previewWsUrl &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-testid={`expanded-thumb-preview-${sibling.id}`}
            style={{
              position: "fixed",
              top: preview.top,
              left: preview.left,
              width: PREVIEW_WIDTH,
              height: PREVIEW_HEIGHT,
              transform: "translate(-50%, -100%)",
              background: terminalTheme.background,
              border: `1px solid ${colors.line}`,
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 24px 64px -20px black",
              zIndex: 60,
              pointerEvents: "none",
              animation: "webmuxFadeIn 120ms ease-out",
            }}
          >
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
                  machineId={sibling.machine_id}
                  terminalId={sibling.id}
                  wsUrl={previewWsUrl}
                  cols={sibling.cols}
                  rows={sibling.rows}
                  displayMode="card"
                  isController={false}
                  canResizeTerminal={false}
                  style={{
                    transform: "scale(0.6)",
                    transformOrigin: "top left",
                    width: "166.7%",
                    height: "166.7%",
                  }}
                />
              </div>
            </Suspense>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------- helpers ---------- */

const iconBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: colors.fg2,
  background: "none",
  border: "none",
  cursor: "pointer",
};

function TrafficDot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: color,
        display: "inline-block",
      }}
    />
  );
}

const TINT_PALETTE = ["#fb9d59", "#bb9af4", "#69c1fc", "#63d18f", "#ef7f7a"];
function tintForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TINT_PALETTE[Math.abs(h) % TINT_PALETTE.length];
}

function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}

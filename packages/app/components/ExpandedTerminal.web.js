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
import { memo, useEffect, useRef } from "react";
import { Expand, RefreshCw, X } from "lucide-react";
import { TerminalCard } from "./TerminalCard.web";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
function ExpandedTerminalComponent(props) {
    const { terminal, siblings, isController, deviceId, isMobile, onClose, onPick, onDestroy, onRequestControl, onReleaseControl, } = props;
    const cardRef = useRef(null);
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
        const handler = (e) => {
            if (e.target instanceof HTMLElement && e.target.closest(".xterm")) {
                return;
            }
            if (e.altKey && e.key === "ArrowLeft") {
                e.preventDefault();
                const idx = siblings.findIndex((s) => s.id === terminal.id);
                const prev = siblings[idx - 1];
                if (prev)
                    onPick(prev.id);
            }
            if (e.altKey && e.key === "ArrowRight") {
                e.preventDefault();
                const idx = siblings.findIndex((s) => s.id === terminal.id);
                const next = siblings[idx + 1];
                if (next)
                    onPick(next.id);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [siblings, terminal.id, onPick]);
    return (<div data-testid="expanded-terminal" onClick={onClose} style={{
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
        }}>
      <div onClick={(e) => e.stopPropagation()} style={{
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
        }}>
        {/* Header */}
        <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: `1px solid ${colors.lineSoft}`,
            background: colors.bg2,
            flexShrink: 0,
        }}>
          {/* Traffic lights */}
          <div style={{ display: "flex", gap: 6 }}>
            <TrafficDot color={colors.err}/>
            <TrafficDot color={colors.warn}/>
            <TrafficDot color={colors.ok}/>
          </div>
          <span style={{ color: colors.fg3 }}>·</span>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: tintColor,
            boxShadow: `0 0 0 3px ${tintColor}33`,
            flexShrink: 0,
        }}/>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.fg0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
        }}>
            {terminal.title || short}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: colors.fg3,
        }}>
            {short}
          </span>
          <span style={{ color: colors.fg3 }}>·</span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: colors.fg2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        }}>
            {shortenHome(terminal.cwd)}
          </span>
          {isController && (<span style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 4,
                background: colorAlpha.accentSoft,
                color: colors.accent,
                border: `1px solid ${colorAlpha.accentLine}`,
                flexShrink: 0,
            }}>
              ctrl
            </span>)}
          <div style={{ flex: 1 }}/>

          <button onClick={() => cardRef.current?.fitToContainer()} title="Re-fit terminal" aria-label="Re-fit terminal" style={iconBtn}>
            <RefreshCw size={13}/>
          </button>
          <button onClick={() => cardRef.current?.fitToContainer()} title="Fit" aria-label="Fit" style={iconBtn}>
            <Expand size={13}/>
          </button>
          <button onClick={onClose} title="Collapse (Esc)" aria-label="Collapse" style={{ ...iconBtn, color: colors.fg1 }} data-testid="expanded-close">
            <X size={14}/>
          </button>
        </div>

        {/* Terminal body */}
        <div style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            background: terminalTheme.background,
            display: "flex",
        }}>
          <TerminalCard ref={cardRef} terminal={terminal} displayMode="tab" isMobile={isMobile} isController={isController} deviceId={deviceId} onSelectTab={() => { }} onDestroy={onDestroy} onRequestControl={onRequestControl} onReleaseControl={onReleaseControl}/>
        </div>

        {/* Meta + sibling thumbnail strip */}
        <div style={{
            padding: "10px 14px",
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg1,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flexShrink: 0,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: colors.fg3,
        }}>
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
            <div style={{ flex: 1 }}/>
            <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
        }}>
              <kbd style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            border: `1px solid ${colors.line}`,
            borderRadius: 4,
            padding: "0 5px",
            color: colors.fg2,
        }}>
                Esc
              </kbd>
              <span>collapse</span>
            </span>
          </div>

          {siblings.length > 1 && (<div style={{
                display: "flex",
                gap: 6,
                overflowX: "auto",
                paddingBottom: 2,
            }}>
              {siblings.map((s) => {
                const isActive = s.id === terminal.id;
                return (<button key={s.id} onClick={() => onPick(s.id)} data-testid={`expanded-thumb-${s.id}`} style={{
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
                        outline: isActive
                            ? `2px solid ${colors.accent}`
                            : "none",
                        outlineOffset: -1,
                        cursor: "pointer",
                    }}>
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 3,
                    }}>
                      <span style={{
                        width: 5,
                        height: 5,
                        borderRadius: 999,
                        background: tintForId(s.id),
                        flexShrink: 0,
                    }}/>
                      <span style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                        flex: 1,
                    }}>
                        {s.title || s.id.slice(0, 8)}
                      </span>
                    </div>
                    <div style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9.5,
                        color: colors.fg3,
                        lineHeight: 1.35,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}>
                      {shortenHome(s.cwd)}
                    </div>
                  </button>);
            })}
            </div>)}
        </div>
      </div>
    </div>);
}
export const ExpandedTerminal = memo(ExpandedTerminalComponent);
/* ---------- helpers ---------- */
const iconBtn = {
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
function TrafficDot({ color }) {
    return (<span style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: color,
            display: "inline-block",
        }}/>);
}
const TINT_PALETTE = ["#fb9d59", "#bb9af4", "#69c1fc", "#63d18f", "#ef7f7a"];
function tintForId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++)
        h = (h * 31 + id.charCodeAt(i)) | 0;
    return TINT_PALETTE[Math.abs(h) % TINT_PALETTE.length];
}
function shortenHome(path) {
    return path.replace(/^\/home\/[^/]+/, "~");
}

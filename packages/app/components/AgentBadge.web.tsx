// Shared agent-session identity + status bits: the 2-letter monogram badge
// (claude/codex/grok/kimi + the terminal `>_` glyph) and the session status
// dot. Colors and glyphs follow docs/design/next-ia/States.dc.html — amber
// (the brand accent) is reserved for the `asked` state on agent sessions;
// terminal rows never show amber.

import type { AgentKind, AgentSessionStatus } from "@webmux/shared";
import { colors } from "@/lib/colors";

export type SessionKind = AgentKind | "terminal";

interface KindMeta {
  letters: string;
  label: string;
  color: string;
}

export const SESSION_KIND_META: Record<SessionKind, KindMeta> = {
  claude: { letters: "CL", label: "claude", color: colors.accent },
  codex: { letters: "CX", label: "codex", color: colors.ok },
  grok: { letters: "GR", label: "grok", color: colors.fg2 },
  kimi: { letters: "KI", label: "kimi", color: colors.violet },
  terminal: { letters: ">_", label: "terminal", color: colors.fg2 },
};

function alpha(color: string, opacity: number): string {
  // colors.* are `rgb(var(--color-x))`; swap the rgb(…) wrapper for an alpha
  // variant so token values keep working if the palette shifts.
  const match = color.match(/^rgb\((var\(--color-[a-z-]+\))\)$/);
  return match ? `rgb(${match[1]} / ${opacity})` : color;
}

export function AgentBadge({
  kind,
  size = "row",
}: {
  kind: SessionKind;
  size?: "row" | "header";
}) {
  const meta = SESSION_KIND_META[kind];
  const header = size === "header";
  const neutral = kind === "terminal" || kind === "grok";
  return (
    <span
      data-testid={`agent-badge-${kind}`}
      style={{
        width: header ? 26 : 22,
        height: header ? 26 : 15,
        flexShrink: 0,
        borderRadius: header ? 6 : 4,
        border: `1px solid ${neutral ? colors.line : alpha(meta.color, 0.4)}`,
        background: neutral ? colors.bg2 : alpha(meta.color, 0.12),
        color: neutral ? colors.fg2 : meta.color,
        fontFamily: "var(--font-mono)",
        fontSize: header ? 10 : 9,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {meta.letters}
    </span>
  );
}

export const AGENT_STATUS_LABEL: Record<AgentSessionStatus, string> = {
  starting: "starting…",
  working: "working",
  asked: "waiting on you",
  idle: "idle",
  error: "error",
  disconnected: "disconnected",
};

// Session status dot per States.dc.html: working = spinning info-blue arc,
// asked = amber diamond (the ONLY amber state), idle = hollow gray ring,
// error = solid red, disconnected = dashed ring, starting = blinking gray.
export function AgentStatusDot({ status }: { status: AgentSessionStatus }) {
  if (status === "working") {
    return (
      <svg
        width={11}
        height={11}
        viewBox="0 0 24 24"
        fill="none"
        stroke={colors.info}
        strokeWidth={3}
        strokeLinecap="round"
        aria-hidden
        style={{ flexShrink: 0, animation: "webmuxSpin 1.6s linear infinite" }}
      >
        <circle cx={12} cy={12} r={9} opacity={0.25} />
        <path d="M12 3a9 9 0 0 1 9 9" />
      </svg>
    );
  }
  if (status === "asked") {
    return (
      <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden style={{ flexShrink: 0 }}>
        <circle cx={6} cy={6} r={5.5} fill={colors.accent} opacity={0.2} />
        <path d="M6 2 10 6 6 10 2 6z" fill={colors.accent} />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: colors.err,
          flexShrink: 0,
        }}
      />
    );
  }
  if (status === "starting") {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: colors.fg3,
          flexShrink: 0,
          animation: "webmuxBlink 1.2s step-start infinite",
        }}
      />
    );
  }
  // idle = hollow ring; disconnected = dashed ring.
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        border: `1.6px ${status === "disconnected" ? "dashed" : "solid"} ${colors.fg3}`,
        flexShrink: 0,
      }}
    />
  );
}

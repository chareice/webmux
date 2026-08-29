// Full-area chat view for an agent session — the right-side replacement for
// the terminal workspace while an agent session is selected (like a zoomed
// terminal). Layout per docs/design/next-ia/Main.dc.html: header (badge +
// title, machine · cwd, status pill, auto-run label, resume/kill), a
// centered message stream (user turns, assistant text, collapsible thought
// blocks and tool-call rows, ask-cards, error rows, turn dividers), and a
// composer (Enter sends, Shift+Enter newline; Send becomes Stop while the
// agent is working).
//
// The transcript comes from the per-session feed store (backfill + live
// events); session metadata (status/title/auto_run) comes from browserState
// via props. Read state: while the view is open and the window is focused,
// the latest last_event_seq is debounce-synced to PUT /api/agent-sessions/:id/seen
// so other devices clear their unread marker too.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AgentSessionInfo } from "@webmux/shared";
import { ArrowUp, ChevronDown, ChevronRight, Square, X } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { putAgentSessionSeen } from "@/lib/api";
import { useAgentSessionFeed } from "@/lib/agentSessionFeed";
import type { TranscriptBlock } from "@/lib/agentTranscript";
import {
  AgentBadge,
  AgentStatusDot,
  AGENT_STATUS_LABEL,
  SESSION_KIND_META,
} from "./AgentBadge.web";
import { ConfirmDialog } from "./ConfirmDialog";

const SEEN_DEBOUNCE_MS = 1000;

export interface AgentChatViewProps {
  session: AgentSessionInfo;
  machineName: string;
  /** Same gating as terminal input: this device holds the machine's control
   *  lease (or view-only isn't locked). */
  canType: boolean;
  onTakeControl: () => void;
  /** Send free text. When an ask-card is unresolved the canvas routes this
   *  as answer(text) + prompt(text) — ACP has no free-form answer channel. */
  onSend: (text: string) => void;
  /** Cancel the current turn (Stop while working). */
  onStop: () => void;
  onAnswerOption: (requestId: string, optionId: string) => void;
  onKill: () => void;
  onResume: () => void;
}

export function AgentChatView({
  session,
  machineName,
  canType,
  onTakeControl,
  onSend,
  onStop,
  onAnswerOption,
  onKill,
  onResume,
}: AgentChatViewProps) {
  const feed = useAgentSessionFeed(session);
  const [input, setInput] = useState("");
  const [killConfirmOpen, setKillConfirmOpen] = useState(false);

  // ---- read state: debounce last_event_seq → PUT seen while focused ----
  const [windowFocused, setWindowFocused] = useState(
    () => typeof document === "undefined" || document.hasFocus(),
  );
  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const seenSentRef = useRef(0);
  useEffect(() => {
    seenSentRef.current = 0;
  }, [session.id]);
  useEffect(() => {
    if (!windowFocused) return;
    const target = session.last_event_seq;
    if (target <= 0 || target <= seenSentRef.current) return;
    const timer = setTimeout(() => {
      seenSentRef.current = target;
      void putAgentSessionSeen(session.id, target).catch(() => {
        // Allow a later effect run to retry.
        seenSentRef.current = 0;
      });
    }, SEEN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [session.id, session.last_event_seq, windowFocused]);

  // ---- autoscroll: stick to bottom while at bottom ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowJump(false);
  }, []);

  useEffect(() => {
    if (atBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      setShowJump(true);
    }
  }, [feed.blocks]);

  // Reset scroll pinning when switching sessions.
  useEffect(() => {
    atBottomRef.current = true;
    setShowJump(false);
    scrollToBottom();
    setInput("");
  }, [session.id, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = atBottom;
    if (atBottom) setShowJump(false);
  }, []);

  // ---- composer ----
  const status = session.status;
  const live = status !== "disconnected" && status !== "error";
  const working = status === "working";
  const inputEnabled = canType && live;

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !inputEnabled || working) return;
    onSend(text);
    setInput("");
  }, [input, inputEnabled, working, onSend]);

  const handleInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    [send],
  );

  const kindMeta = SESSION_KIND_META[session.agent_kind];
  const resumable = status === "disconnected" || status === "error";

  return (
    <div
      data-testid="agent-chat-view"
      style={{
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
      }}
    >
      {/* header */}
      <div
        data-testid="agent-chat-header"
        style={{
          height: 52,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 12px 0 20px",
          borderBottom: `1px solid ${colors.line}`,
          background: colors.bg1,
        }}
      >
        <AgentBadge kind={session.agent_kind} size="header" />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: colors.fg0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {session.title}
            </span>
            <span style={headerChipStyle}>{kindMeta.label}</span>
            {session.auto_run ? (
              <span
                data-testid="agent-chat-autorun"
                style={{ ...headerChipStyle, background: colors.bg2 }}
              >
                auto-run
              </span>
            ) : (
              <span
                data-testid="agent-chat-autorun"
                style={{
                  ...headerChipStyle,
                  color: colors.warn,
                  border: `1px solid rgb(var(--color-warn) / 0.4)`,
                  background: "rgb(var(--color-warn) / 0.1)",
                }}
              >
                auto-run off
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 3,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.fg3,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: colors.fg2 }}>{machineName}</span>
            <span>·</span>
            <span>{session.cwd}</span>
          </div>
        </div>

        <div style={{ flexGrow: 1 }} />

        <span
          data-testid="agent-chat-status"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 22,
            padding: "0 9px",
            borderRadius: 999,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
            ...(status === "asked"
              ? {
                  background: colorAlpha.accentLight12,
                  border: `1px solid ${colorAlpha.accentLine}`,
                  color: colors.accent,
                }
              : status === "error"
                ? {
                    background: colorAlpha.dangerSoft,
                    border: `1px solid ${colorAlpha.dangerLine}`,
                    color: colors.err,
                  }
                : status === "working"
                  ? {
                      background: "rgb(var(--color-info) / 0.12)",
                      border: "1px solid rgb(var(--color-info) / 0.35)",
                      color: colors.info,
                    }
                  : {
                      background: colorAlpha.mutedLight,
                      border: `1px solid ${colors.line}`,
                      color: colors.fg2,
                    }),
          }}
        >
          <AgentStatusDot status={status} />
          {AGENT_STATUS_LABEL[status]}
        </span>

        {resumable && (
          <button
            type="button"
            data-testid="agent-chat-resume"
            onClick={onResume}
            style={{
              height: 26,
              padding: "0 12px",
              borderRadius: 6,
              border: `1px solid ${colorAlpha.accentLine}`,
              background: "transparent",
              color: colors.accent,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Resume
          </button>
        )}
        <button
          type="button"
          data-testid="agent-chat-kill"
          onClick={() => setKillConfirmOpen(true)}
          title="Kill session"
          aria-label="Kill session"
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: colors.fg2,
            padding: 0,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* message stream */}
      <div style={{ position: "relative", flexGrow: 1, minHeight: 0 }}>
        <div
          ref={scrollRef}
          data-testid="agent-chat-stream"
          onScroll={handleScroll}
          style={{ height: "100%", overflowY: "auto" }}
        >
          <div
            style={{
              maxWidth: 820,
              margin: "0 auto",
              padding: "12px 24px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {!feed.backfilled && (
              <div style={{ fontSize: 12, color: colors.fg3 }}>Loading…</div>
            )}
            {feed.backfilled && feed.blocks.length === 0 && (
              <div style={{ fontSize: 12, color: colors.fg3 }}>
                No messages yet — say something below.
              </div>
            )}
            {feed.blocks.map((block) => (
              <TranscriptBlockView
                key={block.id}
                block={block}
                agentLabel={kindMeta.label}
                onAnswerOption={onAnswerOption}
              />
            ))}
          </div>
        </div>
        {showJump && (
          <button
            type="button"
            data-testid="agent-chat-jump-latest"
            onClick={scrollToBottom}
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              height: 26,
              padding: "0 12px",
              borderRadius: 999,
              border: `1px solid ${colors.line}`,
              background: colors.bg2,
              color: colors.fg1,
              fontSize: 11.5,
              cursor: "pointer",
              boxShadow: "0 6px 20px rgb(0 0 0 / 0.4)",
            }}
          >
            ↓ jump to latest
          </button>
        )}
      </div>

      {/* composer */}
      <div style={{ flexShrink: 0, padding: "0 24px 16px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {status === "starting" && (
            <div
              data-testid="agent-chat-starting-note"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: colors.fg3,
                marginBottom: 6,
              }}
            >
              starting… messages send as soon as the agent is ready
            </div>
          )}
          {!canType ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: `1px solid ${colors.line}`,
                borderRadius: 10,
                background: colors.bg1,
                padding: "10px 12px",
              }}
            >
              <span
                style={{
                  flexGrow: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: colors.fg3,
                }}
              >
                viewing — another device holds control
              </span>
              <button
                type="button"
                data-testid="agent-chat-take-control"
                onClick={onTakeControl}
                style={{
                  height: 26,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.accent}`,
                  background: "transparent",
                  color: colors.accent,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Take control
              </button>
            </div>
          ) : (
            <div
              style={{
                border: `1px solid ${colors.line}`,
                borderRadius: 10,
                background: colors.bg1,
                display: "flex",
                alignItems: "flex-end",
                gap: 8,
                padding: "10px 10px 10px 14px",
                opacity: live ? 1 : 0.6,
              }}
            >
              <textarea
                data-testid="agent-chat-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleInputKeyDown}
                disabled={!inputEnabled}
                placeholder={
                  live
                    ? status === "asked"
                      ? "Reply to the question above…"
                      : `Message ${kindMeta.label}…`
                    : "Session is not running — resume it first"
                }
                rows={1}
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  border: "none",
                  outline: "none",
                  resize: "none",
                  background: "transparent",
                  color: colors.fg1,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  maxHeight: 160,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: colors.fg3,
                  flexShrink: 0,
                }}
              >
                ↵ send · ⇧↵ newline
              </span>
              {working ? (
                <button
                  type="button"
                  data-testid="agent-chat-stop"
                  onClick={onStop}
                  title="Stop"
                  aria-label="Stop"
                  style={{ ...sendButtonStyle, background: colors.bg3, color: colors.fg1 }}
                >
                  <Square size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="agent-chat-send"
                  onClick={send}
                  disabled={!inputEnabled || input.trim() === ""}
                  title="Send"
                  aria-label="Send"
                  style={{
                    ...sendButtonStyle,
                    opacity: !inputEnabled || input.trim() === "" ? 0.45 : 1,
                    cursor:
                      !inputEnabled || input.trim() === "" ? "not-allowed" : "pointer",
                  }}
                >
                  <ArrowUp size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={killConfirmOpen}
        title={`Kill "${session.title}"?`}
        message="The agent process is terminated and the session's event log is deleted. This cannot be undone."
        confirmLabel="Kill session"
        variant="danger"
        onConfirm={() => {
          setKillConfirmOpen(false);
          onKill();
        }}
        onCancel={() => setKillConfirmOpen(false)}
      />
    </div>
  );
}

/* ---------- transcript blocks ---------- */

function TranscriptBlockView({
  block,
  agentLabel,
  onAnswerOption,
}: {
  block: TranscriptBlock;
  agentLabel: string;
  onAnswerOption: (requestId: string, optionId: string) => void;
}) {
  switch (block.kind) {
    case "user":
      return (
        <div
          data-testid="agent-msg-user"
          style={{
            borderLeft: `2px solid ${colors.line}`,
            padding: "1px 0 1px 14px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              color: colors.fg2,
              marginBottom: 6,
            }}
          >
            YOU
          </div>
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.75,
              color: colors.fg1,
              whiteSpace: "pre-wrap",
            }}
          >
            {block.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div
          data-testid="agent-msg-assistant"
          style={{
            fontSize: 13.5,
            lineHeight: 1.75,
            color: colors.fg1,
            whiteSpace: "pre-wrap",
          }}
        >
          {block.text}
        </div>
      );
    case "thought":
      return <ThoughtBlock block={block} />;
    case "tool_call":
      return <ToolCallBlock block={block} />;
    case "question":
      return <QuestionBlock block={block} agentLabel={agentLabel} onAnswerOption={onAnswerOption} />;
    case "plan":
      return <PlanBlock block={block} />;
    case "error":
      return (
        <div
          data-testid="agent-msg-error"
          style={{
            fontSize: 12.5,
            color: colors.err,
            border: `1px solid ${colorAlpha.dangerLine}`,
            background: colorAlpha.dangerSoft,
            borderRadius: 6,
            padding: "8px 11px",
            whiteSpace: "pre-wrap",
          }}
        >
          {block.message}
        </div>
      );
    case "turn_end":
      return (
        <div
          data-testid="agent-turn-divider"
          style={{
            height: 1,
            background: colors.lineSoft,
            margin: "2px 0",
          }}
        />
      );
    default:
      return null;
  }
}

function ThoughtBlock({ block }: { block: Extract<TranscriptBlock, { kind: "thought" }> }) {
  const [open, setOpen] = useState(false);
  const firstLine = block.text.split("\n", 1)[0] ?? "";
  return (
    <div
      style={{
        borderRadius: 6,
        border: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        data-testid="agent-thought-toggle"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: 28,
          padding: "0 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={11} color={colors.fg3} /> : <ChevronRight size={11} color={colors.fg3} />}
        <span style={{ fontSize: 11.5, color: colors.fg2, flexShrink: 0 }}>Thinking</span>
        {!open && (
          <span
            style={{
              fontSize: 11.5,
              color: colors.fg3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              opacity: 0.7,
            }}
          >
            {firstLine}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="agent-thought-content"
          style={{
            padding: "4px 10px 10px",
            fontSize: 12,
            lineHeight: 1.7,
            color: colors.fg2,
            whiteSpace: "pre-wrap",
          }}
        >
          {block.text}
        </div>
      )}
    </div>
  );
}

function toolStatusIcon(status: string) {
  if (status === "completed") {
    return (
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.ok} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="4 12.5 9.5 18 20 6.5" />
      </svg>
    );
  }
  if (status === "failed" || status === "error") {
    return <X size={12} color={colors.err} />;
  }
  // in_progress / pending / anything else: spinning arc.
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
      style={{ animation: "webmuxSpin 1.6s linear infinite" }}
    >
      <circle cx={12} cy={12} r={9} opacity={0.25} />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}

function ToolCallBlock({ block }: { block: Extract<TranscriptBlock, { kind: "tool_call" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid={`agent-tool-call-${block.toolCallId}`}
      style={{
        borderRadius: 6,
        border: `1px solid ${open ? colors.line : colors.lineSoft}`,
        background: colors.bg1,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          height: 30,
          padding: "0 10px",
          border: "none",
          borderBottom: open ? `1px solid ${colors.lineSoft}` : "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={11} color={colors.fg2} /> : <ChevronRight size={11} color={colors.fg3} />}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            fontWeight: 700,
            color: colors.fg1,
            flexShrink: 0,
          }}
        >
          {block.title}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: colors.fg2,
            flexGrow: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {block.toolKind ?? ""}
        </span>
        <span
          data-testid={`agent-tool-call-${block.toolCallId}-status`}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: colors.fg3,
            flexShrink: 0,
          }}
        >
          {block.status}
        </span>
        {toolStatusIcon(block.status)}
      </button>
      {open && block.content !== null && (
        <pre
          data-testid={`agent-tool-call-${block.toolCallId}-content`}
          style={{
            margin: 0,
            background: colors.termBg,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.85,
            padding: "8px 10px",
            color: colors.fg1,
            whiteSpace: "pre-wrap",
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {block.content}
        </pre>
      )}
    </div>
  );
}

function QuestionBlock({
  block,
  agentLabel,
  onAnswerOption,
}: {
  block: Extract<TranscriptBlock, { kind: "question" }>;
  agentLabel: string;
  onAnswerOption: (requestId: string, optionId: string) => void;
}) {
  const resolved = block.resolved;
  return (
    <div
      data-testid={`agent-ask-card-${block.requestId}`}
      style={{
        border: `1px solid ${resolved ? colors.line : colorAlpha.accentLine}`,
        borderRadius: 10,
        background: colors.bg2,
        overflow: "hidden",
        opacity: resolved ? 0.55 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          padding: "0 12px",
          background: resolved ? "transparent" : colorAlpha.accentLight12,
          borderBottom: `1px solid ${resolved ? colors.lineSoft : colorAlpha.accentBorder}`,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: resolved ? colors.fg2 : colors.accent, flexGrow: 1 }}>
          {agentLabel} is asking
        </span>
        {resolved && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.fg3,
            }}
          >
            resolved
          </span>
        )}
      </div>
      <div style={{ padding: "13px 14px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: colors.fg0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {block.prompt}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {block.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              data-testid={`agent-ask-option-${option.id}`}
              disabled={resolved}
              onClick={() => onAnswerOption(block.requestId, option.id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 11px",
                borderRadius: 8,
                border: `1px solid ${colors.bg3}`,
                background: colors.bg3,
                cursor: resolved ? "default" : "pointer",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 17,
                  height: 17,
                  flexShrink: 0,
                  borderRadius: 4,
                  border: `1px solid ${colors.line}`,
                  color: colors.fg1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: colors.fg0 }}>
                  {option.label}
                </span>
                {option.detail && (
                  <span style={{ display: "block", fontSize: 11.5, color: colors.fg2, marginTop: 3, lineHeight: 1.55 }}>
                    {option.detail}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        {!resolved && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flexGrow: 1, height: 1, background: colors.line }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: colors.fg3, flexShrink: 0 }}>
              or reply below
            </span>
            <div style={{ flexGrow: 1, height: 1, background: colors.line }} />
          </div>
        )}
      </div>
    </div>
  );
}

function PlanBlock({ block }: { block: Extract<TranscriptBlock, { kind: "plan" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderRadius: 6,
        border: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        data-testid="agent-plan-toggle"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: 28,
          padding: "0 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 11.5,
          color: colors.fg2,
        }}
      >
        {open ? <ChevronDown size={11} color={colors.fg3} /> : <ChevronRight size={11} color={colors.fg3} />}
        Plan
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: "4px 10px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.7,
            color: colors.fg2,
            whiteSpace: "pre-wrap",
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {block.entriesJson}
        </pre>
      )}
    </div>
  );
}

/* ---------- styles ---------- */

const headerChipStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: colors.fg3,
  border: `1px solid ${colors.line}`,
  borderRadius: 4,
  padding: "1px 5px",
  whiteSpace: "nowrap",
};

const sendButtonStyle: CSSProperties = {
  width: 26,
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  border: "none",
  background: colors.accent,
  color: colors.bg0,
  padding: 0,
  cursor: "pointer",
  flexShrink: 0,
};

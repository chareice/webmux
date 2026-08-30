// Mobile workbench shell (P1). Rendered when the viewport is below 768px.
// Permanent chrome is exactly two elements: the session title bar on top and
// the extended key bar at the bottom (the key bar renders inside
// TerminalCard); the active terminal fills everything between them. The old
// 3-tab bottom nav (Hosts/Terminals/Stats), the app bar, the FAB and the
// card-list landing are gone — the app opens straight into the last-active
// terminal. Host switching, control toggling, reconnect and settings live
// in the host sheet (reached through the session switcher header); per-session
// actions live in the long-press sheet. See SPEC-PHASE3.md and the design doc §4.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgentSessionInfo,
  MachineInfo,
  ResourceStats,
  TerminalInfo,
} from "@webmux/shared";
import {
  ChevronRight,
  CircuitBoard,
  Lock,
  LockOpen,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { displayTerminalTitle } from "@/lib/displayTerminalTitle";
import { diskPercent, diskTooltip } from "@/lib/resourceStats";
import { formatAge } from "@/lib/formatAge";
import {
  buildMobileSessionGroups,
  type MobileSessionRow,
} from "@/lib/mobileSessionSwitcher";
import type { SidebarAskedSession } from "@/lib/sidebarTree";
import type { WorkspaceGroup } from "@/lib/terminalWorkspaceLayout";
import {
  AgentBadge,
  AgentStatusDot,
  AGENT_STATUS_LABEL,
  SESSION_KIND_META,
} from "./AgentBadge.web";
import { useStartingElapsedSec } from "@/lib/agentStarting";

interface MobileWorkbenchProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  machineStats: Record<string, ResourceStats>;
  rttMs: number | null;
  // All terminals across machines (the title bar scopes them to the active
  // machine via `groups`; the host sheet needs the full list for counts).
  terminals: TerminalInfo[];
  // Session order: persistent groups by sort_order, then cwd fallback groups
  // (same grouping the desktop TabBar renders).
  groups: WorkspaceGroup[];
  activeTerminalId: string | null;
  canCreateTerminal: boolean;
  onPickTerminal: (id: string) => void;
  // null group = machine home directory (empty state / no active group).
  onNewTerminal: (group: WorkspaceGroup | null) => void;
  onCloseTerminal: (terminal: TerminalInfo) => void;
  // Agent sessions across machines (scoped internally, same as `terminals`).
  agentSessions: AgentSessionInfo[];
  // session id → last_seen_seq for the current user (unread markers).
  agentSessionSeen: Record<string, number>;
  // Sessions with status "asked", oldest first — across ALL machines; the
  // inbox must surface a blocked session even on another host.
  askedSessions: SidebarAskedSession[];
  selectedAgentSessionId: string | null;
  onPickAgentSession: (machineId: string, sessionId: string) => void;
  // Kill lives behind the title-bar ✕ while a chat is open (agent rows in
  // the switcher sheet get no close button, matching the desktop sidebar).
  onKillAgentSession: (session: AgentSessionInfo) => void;
  // The title-bar ＋ and the switcher's "New session" row open the
  // new-session sheet; the active group seeds its directory step.
  onOpenNewSession: (group: WorkspaceGroup | null) => void;
  onSelectMachine: (id: string) => void;
  onAddMachine: () => void;
  onRemoveHost: (machineId: string) => void;
  onRequestControl: (machineId: string) => void;
  viewOnlyLocked: boolean;
  onEngageViewOnly: (machineId: string) => void;
  onDisengageViewOnly: () => void;
  onOpenSettings: () => void;
  // Full-screen chat for the selected agent session; replaces the terminal
  // area (including its empty state) while set.
  chatContent?: React.ReactNode;
  // The inline TerminalWorkspace (null while the machine has no terminals).
  children: React.ReactNode;
}

function MobileWorkbenchComponent(props: MobileWorkbenchProps) {
  const {
    machines,
    activeMachineId,
    controlLeases,
    deviceId,
    machineStats,
    rttMs,
    terminals,
    groups,
    activeTerminalId,
    canCreateTerminal,
    onPickTerminal,
    onNewTerminal,
    onCloseTerminal,
    agentSessions,
    agentSessionSeen,
    askedSessions,
    selectedAgentSessionId,
    onPickAgentSession,
    onKillAgentSession,
    onOpenNewSession,
    onSelectMachine,
    onAddMachine,
    onRemoveHost,
    onRequestControl,
    viewOnlyLocked,
    onEngageViewOnly,
    onDisengageViewOnly,
    onOpenSettings,
    chatContent,
    children,
  } = props;

  const [hostSheetOpen, setHostSheetOpen] = useState(false);
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [chipSheet, setChipSheet] = useState<Extract<
    MobileSessionRow,
    { kind: "terminal" }
  > | null>(null);

  // Center the active terminal's row when the switcher opens: with a dozen
  // terminals across several tabs the highlighted row is usually off-screen
  // and the user had to scroll hunting for it.
  useEffect(() => {
    if (!sessionSwitcherOpen) return;
    document
      .querySelector(
        '[data-testid="mobile-session-switcher"] [aria-current="true"]',
      )
      ?.scrollIntoView({ block: "center" });
  }, [sessionSwitcherOpen]);

  const activeMachine =
    machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;
  const isController =
    activeMachine !== null &&
    deviceId !== null &&
    controlLeases[activeMachine.id] === deviceId;

  // Sessions only cover the active machine; the empty state keys off the
  // same scoped list the canvas uses to decide whether to mount the
  // workspace.
  const scopedTerminals = useMemo(() => {
    if (!activeMachine) return [];
    return terminals.filter((t) => t.machine_id === activeMachine.id);
  }, [terminals, activeMachine]);

  const scopedAgentSessions = useMemo(() => {
    if (!activeMachine) return [];
    return agentSessions.filter((s) => s.machine_id === activeMachine.id);
  }, [agentSessions, activeMachine]);

  const sessionGroups = useMemo(
    () =>
      buildMobileSessionGroups(
        groups,
        terminals,
        scopedAgentSessions,
        agentSessionSeen,
        selectedAgentSessionId,
      ),
    [
      groups,
      terminals,
      scopedAgentSessions,
      agentSessionSeen,
      selectedAgentSessionId,
    ],
  );
  const rows = useMemo(
    () => sessionGroups.flatMap((sessionGroup) => sessionGroup.rows),
    [sessionGroups],
  );

  // The chat page is machine-agnostic (the canvas can keep a session open
  // across a host switch), so the selected session comes from the full list.
  const activeAgentSession = selectedAgentSessionId
    ? (agentSessions.find((s) => s.id === selectedAgentSessionId) ?? null)
    : null;
  const activeTerminalRow =
    rows.find(
      (row): row is Extract<MobileSessionRow, { kind: "terminal" }> =>
        row.kind === "terminal" && row.terminal.id === activeTerminalId,
    ) ?? null;
  const activeRow = activeAgentSession
    ? (rows.find(
        (row) => row.kind === "agent" && row.session.id === activeAgentSession.id,
      ) ?? null)
    : activeTerminalRow;
  const activeGroup = activeRow?.group ?? activeTerminalRow?.group ?? null;
  const activePosition = activeRow ? rows.indexOf(activeRow) + 1 : 0;

  // Asked sessions other than the open chat drive the cross-session reminder.
  const otherAskedSessions = activeAgentSession
    ? askedSessions.filter((entry) => entry.sessionId !== activeAgentSession.id)
    : [];

  // Starting-state honesty (same rule as the desktop chat header): the pill
  // names the agent and ticks elapsed seconds instead of a bare "starting…".
  const activeAgentStarting = activeAgentSession?.status === "starting";
  const startingElapsedSec = useStartingElapsedSec(activeAgentStarting);

  // Prev/next in strip order (terminals and agent sessions share one order);
  // no wraparound at either end.
  const switchSessionByOffset = useCallback(
    (offset: number) => {
      const activeId = activeAgentSession?.id ?? activeTerminalId;
      const index = rows.findIndex((row) =>
        row.kind === "terminal"
          ? row.terminal.id === activeId
          : row.session.id === activeId,
      );
      if (index === -1) return;
      const next = rows[index + offset];
      if (!next) return;
      if (next.kind === "terminal") {
        onPickTerminal(next.terminal.id);
      } else {
        onPickAgentSession(next.session.machine_id, next.session.id);
      }
    },
    [rows, activeAgentSession, activeTerminalId, onPickTerminal, onPickAgentSession],
  );

  const titleBarTimerRef = useRef<number | null>(null);
  const titleBarTouchRef = useRef<{
    x: number;
    y: number;
    allowSwipe: boolean;
  } | null>(null);
  const suppressTitleBarClickRef = useRef(false);
  const cancelTitleBarTimer = useCallback(() => {
    if (titleBarTimerRef.current !== null) {
      window.clearTimeout(titleBarTimerRef.current);
      titleBarTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelTitleBarTimer, [cancelTitleBarTimer]);

  const handleTitleBarTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      suppressTitleBarClickRef.current = false;
      cancelTitleBarTimer();
      titleBarTouchRef.current = touch
        ? {
            x: touch.clientX,
            y: touch.clientY,
            allowSwipe:
              !(event.target instanceof Element) ||
              !event.target.closest("[data-title-bar-swipe='ignore']"),
          }
        : null;
      // Long-press is a terminal-pane gesture; while a chat is open the
      // title bar belongs to the agent session (kill has its own button).
      if (!activeTerminalRow || activeAgentSession) return;
      titleBarTimerRef.current = window.setTimeout(() => {
        titleBarTimerRef.current = null;
        suppressTitleBarClickRef.current = true;
        setChipSheet(activeTerminalRow);
      }, 500);
    },
    [activeTerminalRow, activeAgentSession, cancelTitleBarTimer],
  );

  const handleTitleBarTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const start = titleBarTouchRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      if (
        Math.abs(touch.clientX - start.x) > 10 ||
        Math.abs(touch.clientY - start.y) > 10
      ) {
        cancelTitleBarTimer();
      }
    },
    [cancelTitleBarTimer],
  );

  const handleTitleBarTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      cancelTitleBarTimer();
      const start = titleBarTouchRef.current;
      titleBarTouchRef.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch || suppressTitleBarClickRef.current) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (
        start.allowSwipe &&
        Math.abs(dx) >= 48 &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        suppressTitleBarClickRef.current = true;
        switchSessionByOffset(dx < 0 ? 1 : -1);
      }
    },
    [cancelTitleBarTimer, switchSessionByOffset],
  );

  // Edge swipe: a horizontal swipe that STARTS within 24px of the left/right
  // screen edge switches to the prev/next terminal in strip order. Touches
  // starting anywhere else are ignored entirely — no preventDefault, no
  // capture — so terminal scroll and mouse-tracking apps keep working.
  const terminalAreaRef = useRef<HTMLDivElement>(null);
  const edgeSwipeRef = useRef<{
    x: number;
    y: number;
    edge: "left" | "right";
  } | null>(null);
  useEffect(() => {
    const node = terminalAreaRef.current;
    if (!node) return;
    const EDGE_PX = 24;
    const MIN_SWIPE_PX = 48;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        edgeSwipeRef.current = null;
        return;
      }
      const touch = event.touches[0];
      if (touch.clientX <= EDGE_PX) {
        edgeSwipeRef.current = { x: touch.clientX, y: touch.clientY, edge: "left" };
      } else if (touch.clientX >= window.innerWidth - EDGE_PX) {
        edgeSwipeRef.current = { x: touch.clientX, y: touch.clientY, edge: "right" };
      } else {
        edgeSwipeRef.current = null;
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = edgeSwipeRef.current;
      edgeSwipeRef.current = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // Mostly-vertical gestures are terminal scrolls, not pane switches.
      if (Math.abs(dy) >= Math.abs(dx)) return;
      if (start.edge === "left" && dx >= MIN_SWIPE_PX) {
        switchSessionByOffset(-1);
      } else if (start.edge === "right" && dx <= -MIN_SWIPE_PX) {
        switchSessionByOffset(1);
      }
    };
    const onTouchCancel = () => {
      edgeSwipeRef.current = null;
    };
    // Capture phase: xterm stops touch propagation inside the terminal, so
    // bubble-phase listeners here would never see edge touches.
    node.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    node.addEventListener("touchend", onTouchEnd, {
      capture: true,
      passive: true,
    });
    node.addEventListener("touchcancel", onTouchCancel, {
      capture: true,
      passive: true,
    });
    return () => {
      node.removeEventListener("touchstart", onTouchStart, true);
      node.removeEventListener("touchend", onTouchEnd, true);
      node.removeEventListener("touchcancel", onTouchCancel, true);
    };
  }, [switchSessionByOffset]);

  const machineOnline = (machine: MachineInfo) =>
    Boolean(machineStats[machine.id]) ||
    terminals.some((t) => t.machine_id === machine.id && t.reachable);

  return (
    <div
      data-testid="mobile-workbench"
      style={{
        height: "100%",
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        color: colors.fg1,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Mobile V1 session title bar */}
      <div
        data-testid="mobile-title-bar"
        role="button"
        tabIndex={0}
        aria-label="Open session switcher"
        onTouchStart={handleTitleBarTouchStart}
        onTouchMove={handleTitleBarTouchMove}
        onTouchEnd={handleTitleBarTouchEnd}
        onTouchCancel={() => {
          cancelTitleBarTimer();
          titleBarTouchRef.current = null;
        }}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (suppressTitleBarClickRef.current) {
            suppressTitleBarClickRef.current = false;
            return;
          }
          setSessionSwitcherOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSessionSwitcherOpen(true);
          }
        }}
        style={{
          height: 40,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px 0 10px",
          background: colors.bg1,
          borderBottom: `1px solid ${colors.lineSoft}`,
          cursor: "pointer",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div
          data-testid="mobile-title-bar-label"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 5,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {activeAgentSession ? (
            <>
              <AgentBadge kind={activeAgentSession.agent_kind} />
              <span
                style={{
                  flex: "1 1 12ch",
                  minWidth: "8ch",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: colors.fg0,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {activeAgentSession.title}
              </span>
              <span
                data-testid="mobile-title-bar-status"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  flexShrink: 0,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  ...(activeAgentSession.status === "asked"
                    ? {
                        background: colorAlpha.accentLight12,
                        color: colors.accent,
                      }
                    : {
                        background: colors.bg2,
                        color: colors.fg2,
                      }),
                }}
              >
                <AgentStatusDot status={activeAgentSession.status} />
                {activeAgentStarting
                  ? `正在启动 ${SESSION_KIND_META[activeAgentSession.agent_kind].label}… ${startingElapsedSec}s`
                  : AGENT_STATUS_LABEL[activeAgentSession.status]}
              </span>
            </>
          ) : activeTerminalRow ? (
            <>
              <span
                style={{
                  flex: "0 1 110px",
                  minWidth: 0,
                  maxWidth: "32vw",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: colors.fg2,
                  fontSize: 12,
                }}
              >
                {activeTerminalRow.group.label}
              </span>
              <span aria-hidden style={{ color: colors.fg3, flexShrink: 0 }}>
                ·
              </span>
              <span
                style={{
                  flex: "1 1 12ch",
                  minWidth: "12ch",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: colors.fg0,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {displayTerminalTitle(activeTerminalRow.terminal)}
              </span>
            </>
          ) : (
            <span
              style={{ color: colors.fg2, fontSize: 12, overflow: "hidden" }}
            >
              No session
            </span>
          )}
        </div>

        {activeAgentSession && (
          <span
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            onTouchEnd={(event) => event.stopPropagation()}
            style={{ width: 34, height: 34, flexShrink: 0 }}
          >
            <button
              type="button"
              data-testid="mobile-agent-kill"
              disabled={!canCreateTerminal}
              onClick={() => onKillAgentSession(activeAgentSession)}
              title="Kill session"
              aria-label="Kill session"
              style={{
                width: 34,
                height: 34,
                borderRadius: 6,
                border: `1px solid ${colors.lineSoft}`,
                background: "transparent",
                color: colors.fg2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                cursor: canCreateTerminal ? "pointer" : "not-allowed",
                opacity: canCreateTerminal ? 1 : 0.45,
              }}
            >
              <X size={16} />
            </button>
          </span>
        )}

        <span
          onClick={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          onTouchEnd={(event) => event.stopPropagation()}
          style={{ width: 34, height: 34, flexShrink: 0 }}
        >
          <button
            type="button"
            data-testid="mobile-bar-new-session"
            disabled={!canCreateTerminal}
            onClick={() => onOpenNewSession(activeGroup)}
            title="New session"
            aria-label="New session"
            style={{
              width: 34,
              height: 34,
              borderRadius: 6,
              border: `1px solid ${colors.lineSoft}`,
              background: "transparent",
              color: colors.fg2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              cursor: canCreateTerminal ? "pointer" : "not-allowed",
              opacity: canCreateTerminal ? 1 : 0.45,
            }}
          >
            <Plus size={16} />
          </button>
        </span>

        {askedSessions.length > 0 && (
          <span
            data-testid="mobile-inbox-dot"
            title={`${askedSessions.length} waiting on you`}
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: colors.accent,
              flexShrink: 0,
            }}
          />
        )}
        <span
          data-testid="mobile-title-bar-badge"
          data-title-bar-swipe="ignore"
          onClick={(event) => event.stopPropagation()}
          style={{
            flexShrink: 0,
            minWidth: 37,
            padding: "3px 6px",
            borderRadius: 999,
            background: colors.bg2,
            color: colors.fg2,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textAlign: "center",
          }}
        >
          {activePosition}/{rows.length}
        </span>
        <span data-testid="mobile-title-bar-dot" style={{ display: "flex" }}>
          <HostDot
            online={activeMachine ? machineOnline(activeMachine) : false}
            isController={false}
          />
        </span>
      </div>

      {/* Cross-session reminder: while inside a chat, a DIFFERENT session
          waiting on an answer surfaces here; tapping jumps to it. */}
      {otherAskedSessions.length > 0 && (
        <button
          type="button"
          data-testid="mobile-cross-reminder"
          onClick={() =>
            onPickAgentSession(
              otherAskedSessions[0].machineId,
              otherAskedSessions[0].sessionId,
            )
          }
          style={{
            height: 40,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 14px",
            background: colorAlpha.accentLight12,
            border: "none",
            borderBottom: `1px solid ${colorAlpha.accentLine}`,
            color: colors.accent,
            cursor: "pointer",
          }}
        >
          <MessageCircle size={13} style={{ flexShrink: 0 }} />
          <span
            style={{
              flexGrow: 1,
              minWidth: 0,
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "left",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {otherAskedSessions.length} more waiting
            </span>{" "}
            <span style={{ color: colors.accentDim }}>
              · {otherAskedSessions[0].title}
            </span>
          </span>
          <ChevronRight size={14} style={{ flexShrink: 0 }} />
        </button>
      )}

      {/* Terminal area (edge swipes switch sessions in strip order); the
          agent chat page replaces it while a chat is open. */}
      <div
        ref={terminalAreaRef}
        data-testid="mobile-terminal-area"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {chatContent ? (
          chatContent
        ) : scopedTerminals.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.fg3,
              fontSize: 14,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <TerminalIcon size={40} style={{ opacity: 0.35 }} />
              <div style={{ marginTop: 12 }}>No terminals yet</div>
              {canCreateTerminal && (
                <button
                  type="button"
                  data-testid="empty-new-terminal"
                  onClick={() => onNewTerminal(null)}
                  style={{
                    marginTop: 14,
                    background: colors.accent,
                    color: "#120904",
                    border: "none",
                    borderRadius: 999,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Start terminal
                </button>
              )}
            </div>
          </div>
        ) : (
          children
        )}
      </div>

      {/* Session switcher sheet */}
      {sessionSwitcherOpen && (
        <Sheet
          header={
            <SessionSwitcherHeader
              machine={activeMachine}
              online={activeMachine ? machineOnline(activeMachine) : false}
              stats={activeStats}
              rttMs={rttMs}
              onOpenHostSheet={() => {
                setSessionSwitcherOpen(false);
                setHostSheetOpen(true);
              }}
            />
          }
          testid="mobile-session-switcher"
          onClose={() => setSessionSwitcherOpen(false)}
        >
          {/* Inbox: sessions waiting on an answer, oldest first. */}
          {askedSessions.length > 0 && (
            <button
              type="button"
              data-testid="mobile-inbox-banner"
              onClick={() => {
                const oldest = askedSessions[0];
                setSessionSwitcherOpen(false);
                onPickAgentSession(oldest.machineId, oldest.sessionId);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                minHeight: 46,
                padding: "4px 18px",
                background: colorAlpha.accentLight12,
                border: "none",
                borderBottom: `1px solid ${colorAlpha.accentLine}`,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <MessageCircle size={15} color={colors.accent} style={{ flexShrink: 0 }} />
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: colors.accent,
                  }}
                >
                  {askedSessions.length} waiting on you
                </span>
                <span
                  style={{
                    display: "block",
                    marginTop: 1,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: colors.accentDim,
                  }}
                >
                  oldest {formatAge(askedSessions[0].createdAtMs)}
                </span>
              </span>
              <ChevronRight size={15} color={colors.accent} style={{ flexShrink: 0 }} />
            </button>
          )}
          <MenuRow
            icon={<Plus size={17} />}
            label="New session"
            disabled={!canCreateTerminal}
            testid="mobile-session-switcher-new-session"
            onClick={() => {
              setSessionSwitcherOpen(false);
              onOpenNewSession(activeGroup);
            }}
          />
          {sessionGroups.map(({ group, rows: groupRows }) => (
            <section key={group.id}>
              <div
                data-testid={`mobile-session-group-${group.id}`}
                style={{
                  padding: "14px 18px 6px",
                  color: colors.fg2,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                {group.label} · {groupRows.length}{" "}
                {groupRows.length === 1 ? "pane" : "panes"}
              </div>
              {groupRows.map((row) => {
                if (row.kind === "agent") {
                  const { session, unread, selected } = row;
                  return (
                    // Agent rows get no close ✕ — kill lives in the chat
                    // title bar, matching the desktop chat header.
                    <div
                      key={session.id}
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        background: selected ? colors.bg2 : "transparent",
                        borderLeft: selected
                          ? `3px solid ${colors.accent}`
                          : "3px solid transparent",
                      }}
                    >
                      <button
                        type="button"
                        data-testid={`mobile-agent-row-${session.id}`}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => {
                          onPickAgentSession(session.machine_id, session.id);
                          setSessionSwitcherOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flex: 1,
                          minWidth: 0,
                          minHeight: 44,
                          padding: "6px 18px",
                          color: colors.fg1,
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <AgentBadge kind={session.agent_kind} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              color: colors.fg0,
                              fontSize: 14,
                              fontWeight: unread || selected ? 700 : 500,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {session.title}
                          </span>
                          <span
                            style={{
                              display: "block",
                              marginTop: 3,
                              color: colors.fg3,
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {session.cwd}
                          </span>
                        </span>
                        {unread && (
                          <span
                            data-testid={`mobile-agent-row-${session.id}-unread`}
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 999,
                              background: colors.fg0,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <AgentStatusDot status={session.status} />
                      </button>
                    </div>
                  );
                }
                const { terminal } = row;
                const active = terminal.id === activeTerminalId;
                return (
                  // Row = pick button + its own close button. Long-pressing the
                  // title bar closes only the *active* session and nobody finds
                  // it, so every session gets a visible ✕ here.
                  <div
                    key={terminal.id}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      background: active ? colors.bg2 : "transparent",
                      borderLeft: active
                        ? `3px solid ${colors.accent}`
                        : "3px solid transparent",
                    }}
                  >
                    <button
                      type="button"
                      data-testid={`mobile-session-row-${terminal.id}`}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        onPickTerminal(terminal.id);
                        setSessionSwitcherOpen(false);
                      }}
                      style={{
                        display: "block",
                        flex: 1,
                        minWidth: 0,
                        padding: "11px 8px 11px 18px",
                        color: colors.fg1,
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          color: colors.fg0,
                          fontSize: 14,
                          fontWeight: active ? 700 : 500,
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {displayTerminalTitle(terminal)}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: 3,
                          color: colors.fg3,
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {terminal.cwd}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-testid={`mobile-session-close-${terminal.id}`}
                      disabled={!canCreateTerminal}
                      title="Close terminal"
                      aria-label={`Close ${displayTerminalTitle(terminal)}`}
                      onClick={() => onCloseTerminal(terminal)}
                      style={{
                        flexShrink: 0,
                        width: 48,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        border: "none",
                        color: colors.fg3,
                        cursor: canCreateTerminal ? "pointer" : "not-allowed",
                        opacity: canCreateTerminal ? 1 : 0.4,
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </Sheet>
      )}

      {/* Host sheet */}
      {hostSheetOpen && (
        <Sheet title="Hosts" onClose={() => setHostSheetOpen(false)}>
          {machines.map((m) => {
            const isActive = m.id === activeMachine?.id;
            const controlling =
              deviceId !== null && controlLeases[m.id] === deviceId;
            return (
              <div
                key={m.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  background: isActive ? colors.bg2 : "transparent",
                  borderLeft: isActive
                    ? `3px solid ${colors.accent}`
                    : "3px solid transparent",
                }}
              >
              <button
                type="button"
                onClick={() => {
                  onSelectMachine(m.id);
                  setHostSheetOpen(false);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: colors.fg1,
                }}
              >
                <HostDot online={machineOnline(m)} isController={controlling} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: colors.fg0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: colors.fg3,
                    }}
                  >
                    {m.os}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: colors.fg3,
                  }}
                >
                  {terminals.filter((t) => t.machine_id === m.id).length} term
                </div>
              </button>
              <button
                type="button"
                data-testid={`mobile-host-remove-${m.id}`}
                title={`Remove ${m.name}`}
                aria-label={`Remove ${m.name}`}
                onClick={() => {
                  setHostSheetOpen(false);
                  onRemoveHost(m.id);
                }}
                style={{
                  width: 48,
                  height: 48,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  color: colors.fg3,
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
              </div>
            );
          })}
          <MenuRow
            icon={<Plus size={17} />}
            label="Add host"
            onClick={() => {
              setHostSheetOpen(false);
              onAddMachine();
            }}
          />
          {activeMachine &&
            (viewOnlyLocked ? (
              <MenuRow
                icon={<LockOpen size={17} />}
                label="Unlock view only"
                testid="mobile-control-toggle"
                onClick={() => {
                  setHostSheetOpen(false);
                  onDisengageViewOnly();
                }}
              />
            ) : isController ? (
              <MenuRow
                icon={<Lock size={17} />}
                label="View only"
                testid="mobile-control-toggle"
                onClick={() => {
                  setHostSheetOpen(false);
                  onEngageViewOnly(activeMachine.id);
                }}
              />
            ) : (
              <MenuRow
                icon={<CircuitBoard size={17} />}
                label="Take control"
                testid="mobile-control-toggle"
                onClick={() => {
                  setHostSheetOpen(false);
                  onRequestControl(activeMachine.id);
                }}
              />
            ))}
          <MenuRow
            icon={<RefreshCw size={17} />}
            label="Reconnect session"
            onClick={() => window.location.reload()}
          />
          <MenuRow
            icon={<SettingsIcon size={17} />}
            label="Settings"
            onClick={() => {
              setHostSheetOpen(false);
              onOpenSettings();
            }}
          />
        </Sheet>
      )}

      {/* Chip long-press sheet */}
      {chipSheet && (
        <Sheet
          title={`${chipSheet.group.label} · ${displayTerminalTitle(chipSheet.terminal)}`}
          onClose={() => setChipSheet(null)}
        >
          <MenuRow
            icon={<X size={17} />}
            label="Close terminal"
            danger
            disabled={!canCreateTerminal}
            testid="mobile-chip-close-terminal"
            onClick={() => {
              const { terminal } = chipSheet;
              setChipSheet(null);
              onCloseTerminal(terminal);
            }}
          />
          <MenuRow
            icon={<Plus size={17} />}
            label="New terminal here"
            disabled={!canCreateTerminal}
            testid="mobile-chip-new-terminal"
            onClick={() => {
              const { group } = chipSheet;
              setChipSheet(null);
              onNewTerminal(group);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

export const MobileWorkbench = memo(MobileWorkbenchComponent);

/* ---------- title bar and sheet status ---------- */

function SessionSwitcherHeader({
  machine,
  online,
  stats,
  rttMs,
  onOpenHostSheet,
}: {
  machine: MachineInfo | null;
  online: boolean;
  stats: ResourceStats | undefined;
  rttMs: number | null;
  onOpenHostSheet: () => void;
}) {
  const cpu = stats ? Math.round(stats.cpu_percent) : null;
  const mem =
    stats && stats.memory_total > 0
      ? Math.round((stats.memory_used / stats.memory_total) * 100)
      : null;
  const disk = diskPercent(stats);
  return (
    <div
      data-testid="mobile-session-header"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        padding: "4px 16px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: colors.fg3,
      }}
    >
      <button
        type="button"
        data-testid="mobile-host-button"
        onClick={onOpenHostSheet}
        disabled={!machine}
        aria-label="Open hosts"
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 0,
          border: "none",
          background: "transparent",
          color: colors.fg0,
          cursor: machine ? "pointer" : "default",
          textAlign: "left",
        }}
      >
        <span data-testid="mobile-session-header-dot" style={{ display: "flex" }}>
          <HostDot online={online} isController={false} />
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {machine?.name ?? "No host"}
        </span>
        <ChevronRight size={14} style={{ flexShrink: 0, color: colors.fg3 }} />
      </button>
      <span data-testid="mobile-session-header-rtt" style={{ color: colors.fg1 }}>
        {rttMs === null ? "—" : `${Math.round(rttMs)}ms`}
      </span>
      <HeaderMetric
        label="cpu"
        percent={cpu}
        testid="mobile-session-header-cpu"
      />
      <HeaderMetric
        label="mem"
        percent={mem}
        testid="mobile-session-header-mem"
      />
      <HeaderMetric
        label="disk"
        percent={disk}
        title={diskTooltip(stats)}
        testid="mobile-session-header-disk"
      />
    </div>
  );
}

function HeaderMetric({
  label,
  percent,
  testid,
  title,
}: {
  label: string;
  percent: number | null;
  testid: string;
  title?: string;
}) {
  return (
    <span
      data-testid={testid}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        color: colors.fg1,
      }}
    >
      <span>
        {label} {percent === null ? "—" : `${percent}%`}
      </span>
    </span>
  );
}

function HostDot({
  online,
  isController,
}: {
  online: boolean;
  isController: boolean;
}) {
  return (
    <span
      style={{
        position: "relative",
        width: 10,
        height: 10,
        display: "inline-block",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: online ? colors.ok : colors.fg3,
          boxShadow: online ? "0 0 0 3px rgba(99, 209, 143, 0.22)" : "none",
        }}
      />
      {isController && (
        <span
          style={{
            position: "absolute",
            right: -3,
            bottom: -3,
            width: 5,
            height: 5,
            borderRadius: 999,
            background: colors.accent,
            border: `1.5px solid ${colors.bg1}`,
          }}
        />
      )}
    </span>
  );
}

/* ---------- sheets ---------- */

function Sheet({
  title,
  header,
  testid,
  onClose,
  children,
}: {
  title?: string;
  header?: React.ReactNode;
  testid?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      data-testid={testid}
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-end",
        animation: "webmuxFadeIn 120ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: colors.bg1,
          borderTop: `1px solid ${colors.line}`,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxHeight: "80%",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "max(10px, env(safe-area-inset-bottom))",
          animation: "webmuxSlideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 4px",
          }}
        >
          <span
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              background: colors.line,
            }}
          />
        </div>
        {header ?? (title && (
          <div
            style={{
              padding: "4px 16px 8px",
              fontSize: 13,
              fontWeight: 600,
              color: colors.fg0,
            }}
          >
            {title}
          </div>
        ))}
        <div style={{ overflow: "auto", paddingBottom: 4 }}>{children}</div>
      </div>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  disabled,
  danger,
  testid,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  testid?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "14px 18px",
        color: danger ? colors.err : disabled ? colors.fg3 : colors.fg0,
        textAlign: "left",
        borderBottom: `1px solid ${colors.lineSoft}`,
        background: "none",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1 }} />
    </button>
  );
}

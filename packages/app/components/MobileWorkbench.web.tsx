// Mobile workbench shell (P1). Rendered when the viewport is below 768px.
// Permanent chrome is exactly two elements: the session strip on top and
// the extended key bar at the bottom (the key bar renders inside
// TerminalCard); the active terminal fills everything between them. The old
// 3-tab bottom nav (Hosts/Terminals/Stats), the app bar, the FAB and the
// card-list landing are gone — the app opens straight into the last-active
// terminal. Host switching, control toggling, reconnect and settings live
// in the host sheet (strip right end); per-chip actions live in the
// long-press sheet. See SPEC-PHASE3.md and the design doc §4.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MachineInfo,
  ResourceStats,
  TerminalInfo,
} from "@webmux/shared";
import {
  ChevronRight,
  CircuitBoard,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Square,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { colors } from "@/lib/colors";
import {
  workspacePaneOrder,
  type WorkspaceGroup,
} from "@/lib/terminalWorkspaceLayout";

interface StripChip {
  terminal: TerminalInfo;
  group: WorkspaceGroup;
}

interface MobileWorkbenchProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  machineStats: Record<string, ResourceStats>;
  // All terminals across machines (the strip scopes them to the active
  // machine via `groups`; the host sheet needs the full list for counts).
  terminals: TerminalInfo[];
  // Strip order: persistent groups by sort_order, then cwd fallback groups
  // (same grouping the desktop TabBar renders).
  groups: WorkspaceGroup[];
  activeTerminalId: string | null;
  canCreateTerminal: boolean;
  onPickTerminal: (id: string) => void;
  // null group = machine home directory (empty state / no active group).
  onNewTerminal: (group: WorkspaceGroup | null) => void;
  onCloseTerminal: (terminal: TerminalInfo) => void;
  onSelectMachine: (id: string) => void;
  onAddMachine: () => void;
  onRequestControl: (machineId: string) => void;
  onReleaseControl: (machineId: string) => void;
  onOpenSettings: () => void;
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
    terminals,
    groups,
    activeTerminalId,
    canCreateTerminal,
    onPickTerminal,
    onNewTerminal,
    onCloseTerminal,
    onSelectMachine,
    onAddMachine,
    onRequestControl,
    onReleaseControl,
    onOpenSettings,
    children,
  } = props;

  const [hostSheetOpen, setHostSheetOpen] = useState(false);
  const [chipSheet, setChipSheet] = useState<StripChip | null>(null);

  const activeMachine =
    machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;
  const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;
  const isController =
    activeMachine !== null &&
    deviceId !== null &&
    controlLeases[activeMachine.id] === deviceId;

  // Strip chips only cover the active machine; the empty state keys off the
  // same scoped list the canvas uses to decide whether to mount the
  // workspace.
  const scopedTerminals = useMemo(() => {
    if (!activeMachine) return [];
    return terminals.filter((t) => t.machine_id === activeMachine.id);
  }, [terminals, activeMachine]);

  const terminalsById = useMemo(
    () => new Map(terminals.map((t) => [t.id, t])),
    [terminals],
  );

  // One chip per terminal, ordered by group and then split-tree DFS.
  const chips = useMemo<StripChip[]>(() => {
    const list: StripChip[] = [];
    for (const group of groups) {
      for (const id of workspacePaneOrder(group.root)) {
        const terminal = terminalsById.get(id);
        if (terminal) list.push({ terminal, group });
      }
    }
    return list;
  }, [groups, terminalsById]);

  const activeGroup =
    chips.find((chip) => chip.terminal.id === activeTerminalId)?.group ?? null;

  // Prev/next in strip order; no wraparound at either end.
  const switchTerminalByOffset = useCallback(
    (offset: number) => {
      const ids = chips.map((chip) => chip.terminal.id);
      const index = ids.indexOf(activeTerminalId ?? "");
      if (index === -1) return;
      const next = ids[index + offset];
      if (next) onPickTerminal(next);
    },
    [chips, activeTerminalId, onPickTerminal],
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
        switchTerminalByOffset(-1);
      } else if (start.edge === "right" && dx <= -MIN_SWIPE_PX) {
        switchTerminalByOffset(1);
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
  }, [switchTerminalByOffset]);

  const machineOnline = (machine: MachineInfo) =>
    Boolean(machineStats[machine.id]) ||
    terminals.some((t) => t.machine_id === machine.id && t.reachable);

  return (
    <div
      data-testid="mobile-workbench"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        color: colors.fg1,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Session strip */}
      <div
        data-testid="mobile-session-strip"
        style={{
          height: 44,
          flexShrink: 0,
          display: "flex",
          alignItems: "stretch",
          background: colors.bg1,
          borderBottom: `1px solid ${colors.lineSoft}`,
        }}
      >
        {/* Session chips + new-terminal button */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            overflowX: "auto",
            scrollbarWidth: "none",
            padding: "0 6px",
          }}
        >
          {chips.map((chip, index) => (
            <span
              key={chip.terminal.id}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {index > 0 && chips[index - 1].group.id !== chip.group.id && (
                <span
                  aria-hidden
                  style={{
                    width: 1,
                    height: 20,
                    background: colors.lineSoft,
                    flexShrink: 0,
                    margin: "0 2px",
                  }}
                />
              )}
              <StripChipButton
                chip={chip}
                active={chip.terminal.id === activeTerminalId}
                onTap={() => onPickTerminal(chip.terminal.id)}
                onLongPress={() => setChipSheet(chip)}
              />
            </span>
          ))}
          <button
            type="button"
            data-testid="mobile-strip-new-terminal"
            disabled={!canCreateTerminal}
            onClick={() => onNewTerminal(activeGroup)}
            title="New terminal"
            aria-label="New terminal"
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              border: `1px solid ${colors.lineSoft}`,
              background: "transparent",
              color: colors.fg2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              cursor: canCreateTerminal ? "pointer" : "not-allowed",
              opacity: canCreateTerminal ? 1 : 0.45,
            }}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Fixed right end: cpu/mem micro-meters + host button */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 8px",
            borderLeft: `1px solid ${colors.lineSoft}`,
          }}
        >
          <StripMeters stats={activeStats} />
          <button
            type="button"
            data-testid="mobile-host-button"
            onClick={() => setHostSheetOpen(true)}
            title="Host menu"
            aria-label="Host menu"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 8px",
              borderRadius: 6,
              background: colors.bg2,
              border: `1px solid ${colors.lineSoft}`,
              cursor: "pointer",
              maxWidth: 132,
              flexShrink: 0,
            }}
          >
            <HostDot
              online={activeMachine ? machineOnline(activeMachine) : false}
              isController={isController}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: colors.fg0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {activeMachine?.name ?? "No host"}
            </span>
            <ChevronRight
              size={12}
              color={colors.fg3}
              style={{ transform: "rotate(90deg)", flexShrink: 0 }}
            />
          </button>
        </div>
      </div>

      {/* Terminal area (edge swipes switch terminals in strip order) */}
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
        {scopedTerminals.length === 0 ? (
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

      {/* Host sheet */}
      {hostSheetOpen && (
        <Sheet title="Hosts" onClose={() => setHostSheetOpen(false)}>
          {machines.map((m) => {
            const isActive = m.id === activeMachine?.id;
            const controlling =
              deviceId !== null && controlLeases[m.id] === deviceId;
            return (
              <button
                key={m.id}
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
                  background: isActive ? colors.bg2 : "transparent",
                  borderLeft: isActive
                    ? `3px solid ${colors.accent}`
                    : "3px solid transparent",
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
            (isController ? (
              <MenuRow
                icon={<Square size={15} fill="currentColor" />}
                label="Stop control"
                danger
                testid="mobile-control-toggle"
                onClick={() => {
                  setHostSheetOpen(false);
                  onReleaseControl(activeMachine.id);
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
        <Sheet title={chipLabel(chipSheet)} onClose={() => setChipSheet(null)}>
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

/* ---------- strip subcomponents ---------- */

// "{groupLabel} · {terminal.title}", truncated to ~12 chars.
function chipLabel(chip: StripChip): string {
  const title = chip.terminal.title || chip.terminal.id.slice(0, 8);
  const label = `${chip.group.label} · ${title}`;
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

function StripChipButton({
  chip,
  active,
  onTap,
  onLongPress,
}: {
  chip: StripChip;
  active: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  useEffect(() => cancelTimer, [cancelTimer]);

  return (
    <button
      type="button"
      data-testid={`mobile-strip-chip-${chip.terminal.id}`}
      aria-pressed={active}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        longPressedRef.current = false;
        cancelTimer();
        startPosRef.current = touch
          ? { x: touch.clientX, y: touch.clientY }
          : null;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          longPressedRef.current = true;
          onLongPress();
        }, 500);
      }}
      onTouchMove={(event) => {
        const start = startPosRef.current;
        const touch = event.touches[0];
        if (!start || !touch) return;
        // Sliding scrolls the strip; only a held press opens the sheet.
        if (
          Math.abs(touch.clientX - start.x) > 10 ||
          Math.abs(touch.clientY - start.y) > 10
        ) {
          cancelTimer();
        }
      }}
      onTouchEnd={cancelTimer}
      onTouchCancel={cancelTimer}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        // The synthetic click after a long-press must not also switch.
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        onTap();
      }}
      title={`${chip.group.label} · ${chip.terminal.title || chip.terminal.id.slice(0, 8)}`}
      style={{
        height: 30,
        borderRadius: 6,
        border: "none",
        background: active ? colors.bg3 : "transparent",
        color: active ? colors.fg0 : colors.fg2,
        padding: "0 9px",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {chipLabel(chip)}
    </button>
  );
}

function StripMeters({ stats }: { stats: ResourceStats | undefined }) {
  const cpu = stats ? Math.round(stats.cpu_percent) : null;
  const mem =
    stats && stats.memory_total > 0
      ? Math.round((stats.memory_used / stats.memory_total) * 100)
      : null;
  return (
    <div
      data-testid="mobile-strip-meters"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        color: colors.fg3,
      }}
    >
      <StripMeter label="c" percent={cpu} testid="mobile-strip-meter-cpu" />
      <StripMeter label="m" percent={mem} testid="mobile-strip-meter-mem" />
    </div>
  );
}

function StripMeter({
  label,
  percent,
  testid,
}: {
  label: string;
  percent: number | null;
  testid: string;
}) {
  return (
    <span
      data-testid={testid}
      style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
    >
      <span>{label}</span>
      <span
        style={{
          width: 26,
          height: 4,
          borderRadius: 2,
          background: colors.bg3,
          overflow: "hidden",
          display: "inline-block",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${percent ?? 0}%`,
            background: percent === null ? "transparent" : colors.fg2,
            borderRadius: 2,
          }}
        />
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
  onClose,
  children,
}: {
  title?: string;
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
        {title && (
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
        )}
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

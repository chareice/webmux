import { memo, useEffect, useRef, useState } from "react";
import type {
  MachineInfo,
  ResourceStats,
  TerminalInfo,
} from "@webmux/shared";
import { ChevronRight, Plus } from "lucide-react";
import { colors } from "@/lib/colors";

interface HostSwitcherProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  machineStats: Record<string, ResourceStats>;
  terminals: TerminalInfo[];
  onSelectMachine: (id: string) => void;
  onAddMachine?: () => void;
  // Chromeless trigger (dot + name + chevron) for the Phase 2 TabBar.
  compact?: boolean;
}

function HostSwitcherComponent({
  machines,
  activeMachineId,
  controlLeases,
  deviceId,
  machineStats,
  terminals,
  onSelectMachine,
  onAddMachine,
  compact = false,
}: HostSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const active =
    machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;

  if (!active) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: colors.fg3,
          fontSize: 12,
          minWidth: 0,
        }}
      >
        <Logomark />
        <span>No host</span>
      </div>
    );
  }

  const termCountFor = (id: string) =>
    terminals.filter((t) => t.machine_id === id).length;
  const onlineFor = (id: string) =>
    Boolean(machineStats[id]) ||
    terminals.some((t) => t.machine_id === id && t.reachable);
  const controllingActive =
    deviceId !== null && controlLeases[active.id] === deviceId;

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="host-switcher-button"
        style={
          compact
            ? {
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "3px 4px",
                borderRadius: 6,
                background: "transparent",
                border: "none",
                textAlign: "left",
                minWidth: 0,
                color: colors.fg1,
                cursor: "pointer",
              }
            : {
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "6px 10px",
                borderRadius: 10,
                background: open ? colors.bg2 : colors.bg1,
                border: `1px solid ${colors.lineSoft}`,
                textAlign: "left",
                minWidth: 0,
                color: colors.fg1,
                cursor: "pointer",
              }
        }
      >
        <HostDot online={onlineFor(active.id)} controlling={controllingActive} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.fg0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {active.name}
            </span>
            {!compact && (
              <span
                style={{
                  fontSize: 10,
                  color: colors.fg3,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {active.os}
              </span>
            )}
          </div>
        </div>
        <ChevronRight
          size={12}
          color={colors.fg3}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 120ms",
            flexShrink: 0,
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            ...(compact ? { right: 0 } : { left: 0 }),
            minWidth: 240,
            zIndex: 20,
            background: colors.bg1,
            border: `1px solid ${colors.line}`,
            borderRadius: 12,
            padding: 8,
            boxShadow: "0 20px 60px -20px black",
            maxHeight: 360,
            overflow: "auto",
          }}
        >
          <div
            style={{
              padding: "6px 8px 4px",
              fontSize: 10,
              color: colors.fg3,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Hosts · {machines.length}
          </div>
          {machines.map((m) => {
            const isActive = m.id === active.id;
            const online = onlineFor(m.id);
            const controlling =
              deviceId !== null && controlLeases[m.id] === deviceId;
            return (
              <button
                key={m.id}
                onClick={() => {
                  onSelectMachine(m.id);
                  setOpen(false);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 8,
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: isActive ? colors.bg2 : "transparent",
                  color: colors.fg1,
                  marginBottom: 4,
                  cursor: "pointer",
                  border: "none",
                }}
              >
                <HostDot online={online} controlling={controlling} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: colors.fg0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: colors.fg3,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {m.os}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      color: colors.fg3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {m.home_dir}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: colors.fg3,
                    lineHeight: 1.5,
                  }}
                >
                  <div>
                    {online ? machineRowStatus(machineStats[m.id]) : "offline"}
                  </div>
                  <div>{termCountFor(m.id)} term</div>
                </div>
              </button>
            );
          })}
          {onAddMachine && (
            <button
              data-testid="host-switcher-add-machine"
              onClick={() => {
                setOpen(false);
                onAddMachine();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${colors.line}`,
                background: "transparent",
                color: colors.fg0,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Plus size={14} />
              Add host
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const HostSwitcher = memo(HostSwitcherComponent);

function HostDot({
  online,
  controlling,
}: {
  online: boolean;
  controlling: boolean;
}) {
  const dotColor = online ? colors.ok : colors.fg3;
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
          background: dotColor,
          boxShadow: `0 0 0 3px ${
            online
              ? "rgba(99, 209, 143, 0.22)"
              : "rgba(91, 94, 98, 0.22)"
          }`,
        }}
      />
      {controlling && (
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

function machineRowStatus(stats: ResourceStats | undefined): string {
  if (!stats) return "online";
  return `${Math.round(stats.cpu_percent)}% cpu`;
}

function Logomark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <rect
        x="2.5"
        y="3.5"
        width="19"
        height="17"
        rx="3.5"
        stroke={colors.accent}
        strokeWidth="1.6"
      />
      <line
        x1="2.5"
        y1="8.5"
        x2="21.5"
        y2="8.5"
        stroke={colors.accent}
        strokeWidth="1.6"
      />
      <circle cx="5.5" cy="6" r="0.8" fill={colors.accent} />
      <rect
        x="5"
        y="11.5"
        width="5"
        height="6.5"
        rx="1"
        fill={colors.accent}
        opacity={0.35}
      />
      <rect
        x="11"
        y="11.5"
        width="8"
        height="6.5"
        rx="1"
        fill={colors.accent}
        opacity={0.8}
      />
    </svg>
  );
}

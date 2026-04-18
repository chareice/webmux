// Unified left rail (design-refresh).
// Replaces ActivityBar + WorkpathPanel + NavColumn with a single vertical
// column containing: HostSwitcher → search → workpath list → footer actions.
//
// Source of truth for the visual spec is the design bundle's rail.jsx +
// hosts.jsx. Structural notes:
// - Multi-host: HostSwitcher is a button that opens a popover listing hosts
//   with status dots, latency, terminal count, CPU.
// - Single-host: the switcher collapses to a logo + host name + address.
// - Workpaths are filtered by the active host (matches the pre-refresh
//   behaviour in WorkpathPanel).

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  Bookmark,
  MachineInfo,
  ResourceStats,
  TerminalInfo,
} from "@webmux/shared";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { PathInput } from "./PathInput.web";

interface RailProps {
  width: number;
  machines: MachineInfo[];
  activeMachineId: string | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  machineStats: Record<string, ResourceStats>;
  bookmarks: Bookmark[];
  terminals: TerminalInfo[];
  selectedWorkpathId: string | "all";
  canCreateTerminal: boolean;
  addDirectoryOpen: boolean;
  onSelectMachine: (id: string) => void;
  onSelectWorkpath: (id: string) => void;
  onOpenAddDirectory: () => void;
  onCloseAddDirectory: () => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onOpenSettings: () => void;
  onCollapse?: () => void;
}

function RailComponent(props: RailProps) {
  const {
    width,
    machines,
    activeMachineId,
    controlLeases,
    deviceId,
    machineStats,
    bookmarks,
    terminals,
    selectedWorkpathId,
    canCreateTerminal,
    addDirectoryOpen,
    onSelectMachine,
    onSelectWorkpath,
    onOpenAddDirectory,
    onCloseAddDirectory,
    onConfirmAddDirectory,
    onRemoveBookmark,
    onOpenSettings,
    onCollapse,
  } = props;

  const activeMachine = useMemo(
    () =>
      machines.find((m) => m.id === activeMachineId) ??
      machines[0] ??
      null,
    [machines, activeMachineId],
  );

  const [query, setQuery] = useState("");

  const machineBookmarks = useMemo(
    () =>
      activeMachine
        ? bookmarks
            .filter((b) => b.machine_id === activeMachine.id)
            .filter((b) => {
              if (!query) return true;
              const q = query.toLowerCase();
              return (
                b.label.toLowerCase().includes(q) ||
                b.path.toLowerCase().includes(q)
              );
            })
        : [],
    [bookmarks, activeMachine, query],
  );

  const terminalsByBookmark = useMemo(() => {
    const m = new Map<string, number>();
    for (const bm of bookmarks) {
      const count = terminals.filter(
        (t) => t.machine_id === bm.machine_id && t.cwd === bm.path,
      ).length;
      m.set(bm.id, count);
    }
    return m;
  }, [bookmarks, terminals]);

  const activeHostTerminals = activeMachine
    ? terminals.filter((t) => t.machine_id === activeMachine.id)
    : [];

  return (
    <aside
      data-testid="rail"
      style={{
        width,
        flexShrink: 0,
        background: colors.bg0,
        borderRight: `1px solid ${colors.lineSoft}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {/* Host switcher + collapse */}
      <div
        style={{
          padding: "14px 14px 10px 14px",
          borderBottom: `1px solid ${colors.lineSoft}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 10,
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <HostSwitcher
              machines={machines}
              activeMachine={activeMachine}
              controlLeases={controlLeases}
              deviceId={deviceId}
              machineStats={machineStats}
              terminals={terminals}
              onSelect={onSelectMachine}
            />
          </div>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse"
              aria-label="Collapse sidebar"
              style={iconBtn()}
            >
              <ChevronLeft size={13} />
            </button>
          )}
        </div>

        {/* Filter */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderRadius: 7,
            background: colors.bg1,
            border: `1px solid ${colors.lineSoft}`,
          }}
        >
          <Search size={12} color={colors.fg3} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter workpaths…"
            style={{
              background: "transparent",
              border: 0,
              outline: "none",
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: colors.fg0,
            }}
          />
          <kbd
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: colors.fg3,
              border: `1px solid ${colors.line}`,
              padding: "1px 5px",
              borderRadius: 4,
            }}
          >
            ⌘K
          </kbd>
        </label>
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 8px 6px",
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <WorkpathRow
            testId="rail-workpath-all"
            label="All"
            pathHint={null}
            terminalCount={activeHostTerminals.length}
            selected={selectedWorkpathId === "all"}
            onClick={() => onSelectWorkpath("all")}
          />
        </div>

        {machineBookmarks.length > 0 && (
          <SectionLabel>Workpaths · {machineBookmarks.length}</SectionLabel>
        )}

        {machineBookmarks.map((bm) => (
          <WorkpathRow
            key={bm.id}
            testId={`rail-workpath-${bm.id}`}
            label={bm.label}
            pathHint={bm.path}
            terminalCount={terminalsByBookmark.get(bm.id) ?? 0}
            selected={selectedWorkpathId === bm.id}
            onClick={() => onSelectWorkpath(bm.id)}
            onRemove={() => onRemoveBookmark(bm.id)}
          />
        ))}

        {!addDirectoryOpen && machineBookmarks.length === 0 && !query && (
          <div
            style={{
              padding: "20px 12px",
              textAlign: "center",
              color: colors.fg3,
              fontSize: 11,
            }}
          >
            No workpaths yet
          </div>
        )}

        {addDirectoryOpen && activeMachine && (
          <PathInput
            machineId={activeMachine.id}
            onSubmit={(path) => {
              if (!path) {
                onCloseAddDirectory();
                return;
              }
              const exists = bookmarks.some(
                (b) =>
                  b.machine_id === activeMachine.id && b.path === path,
              );
              if (!exists) onConfirmAddDirectory(activeMachine.id, path);
              onCloseAddDirectory();
            }}
            onCancel={onCloseAddDirectory}
          />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "10px 10px 12px",
          borderTop: `1px solid ${colors.lineSoft}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          data-testid="rail-add-workpath"
          onClick={onOpenAddDirectory}
          disabled={!canCreateTerminal}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            borderRadius: 7,
            background: colors.bg1,
            border: `1px solid ${colors.lineSoft}`,
            color: canCreateTerminal ? colors.fg1 : colors.fg3,
            fontSize: 12,
            flex: 1,
            justifyContent: "center",
            cursor: canCreateTerminal ? "pointer" : "not-allowed",
            opacity: canCreateTerminal ? 1 : 0.6,
          }}
        >
          <Plus size={12} />
          Add workpath
        </button>
        <button
          data-testid="rail-open-settings"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          style={iconBtn()}
        >
          <Settings size={13} />
        </button>
      </div>
    </aside>
  );
}

export const Rail = memo(RailComponent);

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 10px 4px 10px",
        fontSize: 10.5,
        fontWeight: 600,
        color: colors.fg3,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </div>
  );
}

function WorkpathRow({
  testId,
  label,
  pathHint,
  terminalCount,
  selected,
  onClick,
  onRemove,
}: {
  testId?: string;
  label: string;
  pathHint: string | null;
  terminalCount: number;
  selected: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "left",
        padding: "7px 10px",
        borderRadius: 8,
        background: selected
          ? colors.bg2
          : hover
            ? colors.bg1
            : "transparent",
        color: selected ? colors.fg0 : colors.fg1,
        position: "relative",
        cursor: "pointer",
        border: "none",
        transition: "background 120ms",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: -1,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 2,
            background: colors.accent,
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: selected ? 600 : 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        {pathHint && (
          <div
            style={{
              fontFamily:
                "var(--font-mono)",
              fontSize: 10.5,
              color: colors.fg3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginTop: 1,
            }}
          >
            {pathHint.replace(/^\/home\/[^/]+/, "~")}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {onRemove && hover && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
            title="Remove workpath"
            aria-label="Remove workpath"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              borderRadius: 4,
              color: colors.fg3,
              cursor: "pointer",
            }}
          >
            <X size={10} />
          </span>
        )}
        {terminalCount > 0 ? (
          <span
            style={{
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: selected ? colorAlpha.accentSoft : colors.bg2,
              color: selected ? colors.accent : colors.fg2,
              fontSize: 10.5,
              fontFamily:
                "var(--font-mono)",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {terminalCount}
          </span>
        ) : (
          <span
            style={{
              color: colors.fg3,
              fontSize: 10.5,
              fontFamily:
                "var(--font-mono)",
            }}
          >
            —
          </span>
        )}
      </div>
    </button>
  );
}

/* ---------- Host switcher ---------- */

function HostSwitcher({
  machines,
  activeMachine,
  controlLeases,
  deviceId,
  machineStats,
  terminals,
  onSelect,
}: {
  machines: MachineInfo[];
  activeMachine: MachineInfo | null;
  controlLeases: Record<string, string>;
  deviceId: string | null;
  machineStats: Record<string, ResourceStats>;
  terminals: TerminalInfo[];
  onSelect: (id: string) => void;
}) {
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

  const onlyOne = machines.length <= 1;
  const active = activeMachine;
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
  const controllingActive =
    deviceId !== null && controlLeases[active.id] === deviceId;

  if (onlyOne) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <Logomark />
        <div style={{ minWidth: 0 }}>
          <div
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
          </div>
          <div
            style={{
              fontFamily:
                "var(--font-mono)",
              fontSize: 10,
              color: colors.fg3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {active.os}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="host-switcher-button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 8px",
          borderRadius: 8,
          background: open ? colors.bg2 : colors.bg1,
          border: `1px solid ${colors.lineSoft}`,
          textAlign: "left",
          minWidth: 0,
          color: colors.fg1,
          cursor: "pointer",
        }}
      >
        <HostDot online controlling={controllingActive} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: colors.fg0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {active.name}
            </span>
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
          </div>
          <HostMetaLine
            machineId={active.id}
            stats={machineStats[active.id]}
            terminals={termCountFor(active.id)}
          />
        </div>
        <ChevronRight
          size={12}
          color={colors.fg3}
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 120ms",
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: colors.bg1,
            border: `1px solid ${colors.line}`,
            borderRadius: 10,
            padding: 6,
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
            }}
          >
            Hosts · {machines.length}
          </div>
          {machines.map((m) => {
            const isActive = m.id === active.id;
            const controlling =
              deviceId !== null && controlLeases[m.id] === deviceId;
            return (
              <button
                key={m.id}
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 8,
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  borderRadius: 6,
                  background: isActive ? colors.bg2 : "transparent",
                  color: colors.fg1,
                  marginBottom: 1,
                  cursor: "pointer",
                  border: "none",
                }}
              >
                <HostDot online controlling={controlling} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: colors.fg0,
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
                      fontFamily:
                        "var(--font-mono)",
                      fontSize: 10,
                      color: colors.fg3,
                    }}
                  >
                    {m.home_dir}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily:
                      "var(--font-mono)",
                    fontSize: 10,
                    color: colors.fg3,
                  }}
                >
                  <div>{termCountFor(m.id)} term</div>
                  {machineStats[m.id] && (
                    <div>{Math.round(machineStats[m.id].cpu_percent)}% cpu</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HostMetaLine({
  machineId: _unused,
  stats,
  terminals,
}: {
  machineId: string;
  stats: ResourceStats | undefined;
  terminals: number;
}) {
  const cpu = stats ? `${Math.round(stats.cpu_percent)}%` : "—";
  const mem = stats && stats.memory_total > 0
    ? `${Math.round((stats.memory_used / stats.memory_total) * 100)}%`
    : "—";
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: colors.fg3,
        display: "flex",
        gap: 6,
      }}
    >
      <span>{terminals} term</span>
      <span>·</span>
      <span>cpu {cpu}</span>
      <span>·</span>
      <span>mem {mem}</span>
    </div>
  );
}

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
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 999,
          background: dotColor,
          boxShadow: `0 0 0 3px ${online
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

// Minimal brandmark — abstract stacked panes, matches the design file.
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

export function iconBtn(): React.CSSProperties {
  return {
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
  };
}

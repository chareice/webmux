// Mobile workbench shell (design-refresh, web-only).
// Rendered when the web viewport is below ~680px. Separates navigation into
// three bottom tabs (Hosts / Terminals / Stats) and keeps terminal focus as
// a fullscreen overlay (handled by ExpandedTerminal in TerminalCanvas).
//
// The native-android build keeps its own `MobileCanvas` / `Canvas.android`
// path — this file is opt-in only from the web orchestrator.
import { memo, useEffect, useMemo, useState } from "react";
import { ChevronRight, CircuitBoard, Folder, MoreHorizontal, Plus, RefreshCw, Search, Settings as SettingsIcon, Square, Terminal as TerminalIcon, } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { Sparkline, mockSeries } from "./WorkbenchHeader.web";
function MobileWorkbenchComponent(props) {
    const { machines, activeMachineId, controlLeases, deviceId, machineStats, bookmarks, terminals, selectedWorkpathId, canCreateTerminal, onSelectMachine, onSelectWorkpath, onOpenTerminal, onNewTerminal, onRequestControl, onReleaseControl, onOpenSettings, } = props;
    const [tab, setTab] = useState("terminals");
    const [hostSheet, setHostSheet] = useState(false);
    const [menuSheet, setMenuSheet] = useState(false);
    const activeMachine = machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;
    const activeStats = activeMachine ? machineStats[activeMachine.id] : undefined;
    const isController = activeMachine !== null &&
        deviceId !== null &&
        controlLeases[activeMachine.id] === deviceId;
    const scopedTerminals = useMemo(() => {
        if (!activeMachine)
            return [];
        const base = terminals.filter((t) => t.machine_id === activeMachine.id);
        if (selectedWorkpathId === "all")
            return base;
        const bm = bookmarks.find((b) => b.id === selectedWorkpathId);
        if (!bm)
            return [];
        return base.filter((t) => t.cwd === bm.path);
    }, [terminals, bookmarks, activeMachine, selectedWorkpathId]);
    const scopedBookmark = selectedWorkpathId === "all"
        ? null
        : bookmarks.find((b) => b.id === selectedWorkpathId) ?? null;
    return (<div data-testid="mobile-workbench" style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: colors.bg0,
            color: colors.fg1,
            overflow: "hidden",
            position: "relative",
        }}>
      {/* App bar */}
      <header style={{
            flexShrink: 0,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderBottom: `1px solid ${colors.lineSoft}`,
            background: colors.bg0,
        }}>
        <button onClick={() => setHostSheet(true)} style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px 7px 9px",
            borderRadius: 999,
            background: colors.bg1,
            border: `1px solid ${colors.lineSoft}`,
            minWidth: 0,
            flex: 1,
            color: colors.fg1,
            cursor: "pointer",
        }}>
          <HostDot isController={isController}/>
          <span style={{
            fontSize: 14,
            fontWeight: 600,
            color: colors.fg0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
        }}>
            {activeMachine?.name ?? "No host"}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: colors.fg3,
            flexShrink: 0,
        }}>
            {activeMachine?.os ?? ""}
          </span>
          <ChevronRight size={13} color={colors.fg3} style={{ marginLeft: 2, transform: "rotate(90deg)" }}/>
        </button>
        <button onClick={() => setMenuSheet(true)} style={mobIconBtn} title="More" aria-label="More">
          <MoreHorizontal size={18}/>
        </button>
      </header>

      {/* Page content */}
      <div style={{
            flex: 1,
            overflow: "hidden",
            position: "relative",
            minHeight: 0,
        }}>
        {tab === "hosts" && (<HostsPage machines={machines} activeMachineId={activeMachineId} controlLeases={controlLeases} deviceId={deviceId} bookmarks={bookmarks} terminals={terminals} selectedWorkpathId={selectedWorkpathId} onSelectMachine={onSelectMachine} onSelectWorkpath={(id) => {
                onSelectWorkpath(id);
                setTab("terminals");
            }}/>)}
        {tab === "terminals" && (<TerminalsPage scopeLabel={scopedBookmark?.label ?? "All"} scopePath={scopedBookmark?.path ?? null} terminals={scopedTerminals} onOpen={onOpenTerminal} onChangeScope={() => setTab("hosts")}/>)}
        {tab === "stats" && (<StatsPage machine={activeMachine} stats={activeStats} isController={isController} onRequestControl={activeMachine
                ? () => onRequestControl(activeMachine.id)
                : undefined} onReleaseControl={activeMachine
                ? () => onReleaseControl(activeMachine.id)
                : undefined} onOpenSettings={onOpenSettings}/>)}
      </div>

      {/* FAB */}
      {tab === "terminals" && canCreateTerminal && (<button data-testid="mobile-fab-new-terminal" onClick={onNewTerminal} style={{
                position: "absolute",
                right: 16,
                bottom: 72,
                zIndex: 10,
                width: 52,
                height: 52,
                borderRadius: 999,
                background: colors.accent,
                color: "#120904",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 12px 28px -8px rgba(251, 157, 89, 0.5), 0 4px 12px -4px black",
            }} title="New terminal" aria-label="New terminal">
          <Plus size={22} strokeWidth={2.2}/>
        </button>)}

      {/* Bottom nav */}
      <nav style={{
            flexShrink: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg0,
            paddingBottom: "max(4px, env(safe-area-inset-bottom))",
        }}>
        <NavBtn icon={<CircuitBoard size={22}/>} label="Hosts" active={tab === "hosts"} badge={machines.length} onClick={() => setTab("hosts")}/>
        <NavBtn icon={<TerminalIcon size={22}/>} label="Terminals" active={tab === "terminals"} badge={scopedTerminals.length} onClick={() => setTab("terminals")}/>
        <NavBtn icon={<SettingsIcon size={22}/>} label="Stats" active={tab === "stats"} onClick={() => setTab("stats")}/>
      </nav>

      {hostSheet && (<Sheet title="Switch host" onClose={() => setHostSheet(false)}>
          {machines.map((m) => {
                const isActive = m.id === activeMachineId;
                const controlling = deviceId !== null && controlLeases[m.id] === deviceId;
                return (<button key={m.id} onClick={() => {
                        onSelectMachine(m.id);
                        setHostSheet(false);
                    }} style={{
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
                    }}>
                <HostDot isController={controlling}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.fg0 }}>
                    {m.name}
                  </div>
                  <div style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: colors.fg3,
                    }}>
                    {m.os}
                  </div>
                </div>
                <div style={{
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: colors.fg3,
                    }}>
                  {terminals.filter((t) => t.machine_id === m.id).length} term
                </div>
              </button>);
            })}
        </Sheet>)}

      {menuSheet && (<Sheet onClose={() => setMenuSheet(false)}>
          <MenuRow icon={<Plus size={17}/>} label="New terminal" disabled={!canCreateTerminal} onClick={() => {
                setMenuSheet(false);
                if (canCreateTerminal)
                    onNewTerminal();
            }}/>
          <MenuRow icon={<Search size={17}/>} label="Find workpath" onClick={() => {
                setMenuSheet(false);
                setTab("hosts");
            }}/>
          <MenuRow icon={<RefreshCw size={17}/>} label="Reconnect session" onClick={() => {
                setMenuSheet(false);
                window.location.reload();
            }}/>
          <MenuRow icon={<SettingsIcon size={17}/>} label="Settings" onClick={() => {
                setMenuSheet(false);
                onOpenSettings();
            }}/>
          {isController && activeMachine && (<MenuRow icon={<Square size={15} fill="currentColor"/>} label="Stop Control" danger onClick={() => {
                    setMenuSheet(false);
                    onReleaseControl(activeMachine.id);
                }}/>)}
        </Sheet>)}
    </div>);
}
export const MobileWorkbench = memo(MobileWorkbenchComponent);
/* ---------- Subcomponents ---------- */
const mobIconBtn = {
    width: 38,
    height: 38,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: colors.fg1,
    background: colors.bg1,
    border: `1px solid ${colors.lineSoft}`,
    flexShrink: 0,
    cursor: "pointer",
};
function NavBtn({ icon, label, active, badge, onClick, }) {
    return (<button onClick={onClick} style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            padding: "8px 4px 6px",
            color: active ? colors.accent : colors.fg2,
            background: "none",
            border: "none",
            cursor: "pointer",
            position: "relative",
        }}>
      <div style={{ position: "relative" }}>
        {icon}
        {badge && badge > 0 ? (<span style={{
                position: "absolute",
                top: -4,
                right: -8,
                minWidth: 15,
                height: 15,
                padding: "0 4px",
                borderRadius: 999,
                background: active ? colors.accent : colors.bg3,
                color: active ? "#120904" : colors.fg1,
                fontSize: 9.5,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: `2px solid ${colors.bg0}`,
            }}>
            {badge}
          </span>) : null}
      </div>
      <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500 }}>
        {label}
      </span>
    </button>);
}
function HostDot({ isController }) {
    return (<span style={{
            position: "relative",
            width: 10,
            height: 10,
            display: "inline-block",
            flexShrink: 0,
        }}>
      <span style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            background: colors.ok,
            boxShadow: "0 0 0 3px rgba(99, 209, 143, 0.22)",
        }}/>
      {isController && (<span style={{
                position: "absolute",
                right: -3,
                bottom: -3,
                width: 5,
                height: 5,
                borderRadius: 999,
                background: colors.accent,
                border: `1.5px solid ${colors.bg1}`,
            }}/>)}
    </span>);
}
/* ---------- Pages ---------- */
function HostsPage({ machines, activeMachineId, controlLeases, deviceId, bookmarks, terminals, selectedWorkpathId, onSelectMachine, onSelectWorkpath, }) {
    const active = machines.find((m) => m.id === activeMachineId) ?? machines[0];
    const machineBookmarks = active
        ? bookmarks.filter((b) => b.machine_id === active.id)
        : [];
    const totalTerminals = active
        ? terminals.filter((t) => t.machine_id === active.id).length
        : 0;
    return (<div style={{ height: "100%", overflow: "auto", padding: "8px 0 16px" }}>
      <SectionHead>Hosts</SectionHead>
      {machines.map((m) => {
            const isActive = m.id === activeMachineId;
            const controlling = deviceId !== null && controlLeases[m.id] === deviceId;
            const count = terminals.filter((t) => t.machine_id === m.id).length;
            return (<button key={m.id} onClick={() => onSelectMachine(m.id)} style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 16px",
                    background: isActive ? colors.bg1 : "transparent",
                    borderLeft: isActive
                        ? `3px solid ${colors.accent}`
                        : "3px solid transparent",
                    border: "none",
                    cursor: "pointer",
                    color: colors.fg1,
                }}>
            <HostDot isController={controlling}/>
            <div style={{ minWidth: 0 }}>
              <div style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: colors.fg0 }}>
                  {m.name}
                </span>
                <span style={{
                    fontSize: 10,
                    color: colors.fg3,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                }}>
                  {m.os}
                </span>
              </div>
              <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: colors.fg3,
                }}>
                {m.home_dir}
              </div>
            </div>
            <div style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: colors.fg3,
                }}>
              <div style={{ color: colors.fg2 }}>{count} term</div>
            </div>
          </button>);
        })}

      <SectionHead style={{ marginTop: 8 }}>
        Workpaths{active ? ` · ${active.name}` : ""}
      </SectionHead>
      <WpRow label="All workpaths" path={null} terminals={totalTerminals} selected={selectedWorkpathId === "all"} onClick={() => onSelectWorkpath("all")}/>
      {machineBookmarks.length > 0 && <SubHead>All · {machineBookmarks.length}</SubHead>}
      {machineBookmarks.map((b) => {
            const count = terminals.filter((t) => t.machine_id === b.machine_id && t.cwd === b.path).length;
            return (<WpRow key={b.id} label={b.label} path={b.path} terminals={count} selected={selectedWorkpathId === b.id} onClick={() => onSelectWorkpath(b.id)}/>);
        })}
    </div>);
}
function WpRow({ label, path, terminals, selected, onClick, }) {
    return (<button onClick={onClick} style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            gap: 12,
            width: "100%",
            textAlign: "left",
            padding: "11px 16px",
            background: selected ? colors.bg1 : "transparent",
            borderLeft: selected
                ? `3px solid ${colors.accent}`
                : "3px solid transparent",
            border: "none",
            cursor: "pointer",
            color: colors.fg1,
        }}>
      <Folder size={16} color={selected ? colors.accent : colors.fg3}/>
      <div style={{ minWidth: 0 }}>
        <div style={{
            fontSize: 14,
            fontWeight: selected ? 600 : 500,
            color: colors.fg0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        }}>
          {label}
        </div>
        {path && (<div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: colors.fg3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
            }}>
            {path.replace(/^\/home\/[^/]+/, "~")}
          </div>)}
      </div>
      {terminals > 0 ? (<span style={{
                minWidth: 22,
                padding: "2px 7px",
                borderRadius: 999,
                background: selected ? colorAlpha.accentSoft : colors.bg2,
                color: selected ? colors.accent : colors.fg2,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                textAlign: "center",
            }}>
          {terminals}
        </span>) : (<span style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: colors.fg3,
            }}>
          —
        </span>)}
    </button>);
}
function TerminalsPage({ scopeLabel, scopePath, terminals, onOpen, onChangeScope, }) {
    return (<div style={{ height: "100%", overflow: "auto", padding: "8px 0 80px" }}>
      <button onClick={onChangeScope} style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "calc(100% - 24px)",
            margin: "4px 12px 10px",
            padding: "10px 12px",
            borderRadius: 10,
            background: colors.bg1,
            border: `1px solid ${colors.lineSoft}`,
            textAlign: "left",
            color: colors.fg1,
            cursor: "pointer",
        }}>
        <Folder size={14} color={colors.fg3}/>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 10,
            color: colors.fg3,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
        }}>
            Workpath
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: colors.fg0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        }}>
            {scopeLabel}
            {scopePath && (<span style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: colors.fg3,
                marginLeft: 6,
            }}>
                {scopePath.replace(/^\/home\/[^/]+/, "~")}
              </span>)}
          </div>
        </div>
        <ChevronRight size={16} color={colors.fg3}/>
      </button>

      {terminals.length === 0 && (<div style={{
                padding: "40px 20px",
                textAlign: "center",
                color: colors.fg3,
            }}>
          <TerminalIcon size={32}/>
          <div style={{ marginTop: 10, fontSize: 13 }}>
            No terminals here yet
          </div>
          <div style={{ marginTop: 3, fontSize: 11 }}>
            Tap + to start one
          </div>
        </div>)}

      {terminals.map((t) => (<MobileTermCard key={t.id} terminal={t} onClick={() => onOpen(t.id)}/>))}
    </div>);
}
function MobileTermCard({ terminal, onClick, }) {
    const short = terminal.id.slice(0, 8);
    return (<button onClick={onClick} data-testid={`mobile-term-card-${terminal.id}`} style={{
            display: "block",
            width: "calc(100% - 24px)",
            margin: "0 12px 10px",
            padding: 0,
            background: colors.bg1,
            border: `1px solid ${colors.lineSoft}`,
            borderRadius: 12,
            textAlign: "left",
            overflow: "hidden",
            cursor: "pointer",
            color: colors.fg1,
        }}>
      <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
        }}>
        <span style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: colors.accent,
            boxShadow: "0 0 0 3px rgba(251, 157, 89, 0.22)",
            flexShrink: 0,
        }}/>
        <span style={{
            fontSize: 14,
            fontWeight: 600,
            color: colors.fg0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
        }}>
          {terminal.title || short}
        </span>
        <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: colors.fg3,
            flexShrink: 0,
        }}>
          {short}
        </span>
      </div>
      <div style={{
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: colors.fg3,
            borderTop: `1px solid ${colors.lineSoft}`,
        }}>
        <span style={{
            minWidth: 0,
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        }}>
          {terminal.cwd.replace(/^\/home\/[^/]+/, "~")}
        </span>
        <span>
          {terminal.cols}×{terminal.rows}
        </span>
      </div>
    </button>);
}
function StatsPage({ machine, stats, isController, onRequestControl, onReleaseControl, onOpenSettings, }) {
    const cpu = stats ? Math.round(stats.cpu_percent) : 0;
    const mem = stats && stats.memory_total > 0
        ? Math.round((stats.memory_used / stats.memory_total) * 100)
        : 0;
    const cpuSeries = useMemo(() => mockSeries(3 + cpu, 40, 0.04, 0.4), [cpu]);
    const memSeries = useMemo(() => mockSeries(7 + mem, 40, 0.18, 0.42), [mem]);
    return (<div style={{ height: "100%", overflow: "auto", padding: "12px 12px 20px" }}>
      <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
        }}>
        <BigStat label="CPU" value={`${cpu}%`} series={cpuSeries} color={colors.accent} fill="rgba(251, 157, 89, 0.16)"/>
        <BigStat label="MEM" value={`${mem}%`} series={memSeries} color={colors.info} fill="rgba(105, 193, 252, 0.16)"/>
      </div>

      {machine && (<Panel title={`${machine.name} · ${machine.os}`}>
          <KV k="Terminals" v={stats ? String(stats.disks.length) : "—"}/>
          <KV k="Memory" v={stats
                ? `${formatBytes(stats.memory_used)} / ${formatBytes(stats.memory_total)}`
                : "—"}/>
          <KV k="Home" v={machine.home_dir}/>
          <KV k="Controlling" v={isController ? "yes" : "no"}/>
        </Panel>)}

      <Panel title="Actions">
        {isController && onReleaseControl && (<ActionRow icon={<Square size={15} fill="currentColor"/>} label="Release control" danger onClick={onReleaseControl}/>)}
        {!isController && onRequestControl && (<ActionRow icon={<CircuitBoard size={16}/>} label="Request control" onClick={onRequestControl}/>)}
        <ActionRow icon={<RefreshCw size={16}/>} label="Reconnect" onClick={() => window.location.reload()}/>
        <ActionRow icon={<SettingsIcon size={16}/>} label="Settings" onClick={onOpenSettings}/>
      </Panel>
    </div>);
}
function BigStat({ label, value, series, color, fill, }) {
    return (<div style={{
            padding: 12,
            border: `1px solid ${colors.lineSoft}`,
            borderRadius: 12,
            background: colors.bg1,
        }}>
      <div style={{
            fontSize: 10.5,
            color: colors.fg3,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
        }}>
        {label}
      </div>
      <div style={{
            fontSize: 24,
            fontWeight: 600,
            color: colors.fg0,
            margin: "2px 0 6px",
            fontVariantNumeric: "tabular-nums",
        }}>
        {value}
      </div>
      <Sparkline data={series} width={140} height={28} color={color} fill={fill}/>
    </div>);
}
function Panel({ title, children }) {
    return (<div style={{
            marginTop: 14,
            padding: 14,
            border: `1px solid ${colors.lineSoft}`,
            borderRadius: 12,
            background: colors.bg1,
        }}>
      <div style={{
            fontSize: 10.5,
            color: colors.fg3,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 10,
            fontWeight: 600,
        }}>
        {title}
      </div>
      {children}
    </div>);
}
function KV({ k, v }) {
    return (<div style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: `1px dashed ${colors.lineSoft}`,
            fontSize: 13,
        }}>
      <span style={{ color: colors.fg3 }}>{k}</span>
      <span style={{
            color: colors.fg0,
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "60%",
        }}>
        {v}
      </span>
    </div>);
}
function ActionRow({ icon, label, danger, onClick, }) {
    return (<button onClick={onClick} style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "10px 2px",
            color: danger ? colors.err : colors.fg1,
            textAlign: "left",
            background: "none",
            border: "none",
            cursor: "pointer",
        }}>
      {icon}
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1 }}/>
      <ChevronRight size={14} color={colors.fg3}/>
    </button>);
}
/* ---------- Sheets ---------- */
function Sheet({ title, onClose, children, }) {
    useEffect(() => {
        const h = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);
    return (<div onClick={onClose} style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "flex-end",
            animation: "webmuxFadeIn 120ms ease-out",
        }}>
      <div onClick={(e) => e.stopPropagation()} style={{
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
        }}>
        <div style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 4px",
        }}>
          <span style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: colors.line,
        }}/>
        </div>
        {title && (<div style={{
                padding: "4px 16px 8px",
                fontSize: 13,
                fontWeight: 600,
                color: colors.fg0,
            }}>
            {title}
          </div>)}
        <div style={{ overflow: "auto", paddingBottom: 4 }}>{children}</div>
      </div>
    </div>);
}
function MenuRow({ icon, label, disabled, danger, onClick, }) {
    return (<button onClick={onClick} disabled={disabled} style={{
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
        }}>
      {icon}
      <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1 }}/>
    </button>);
}
function SectionHead({ children, style, }) {
    return (<div style={{
            padding: "14px 16px 6px",
            fontSize: 10.5,
            color: colors.fg3,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            ...style,
        }}>
      {children}
    </div>);
}
function SubHead({ children }) {
    return (<div style={{
            padding: "10px 16px 4px",
            fontSize: 10,
            color: colors.fg3,
            letterSpacing: "0.05em",
            fontWeight: 500,
        }}>
      {children}
    </div>);
}
/* ---------- utils ---------- */
function formatBytes(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1)
        return `${gb.toFixed(1)}G`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)}M`;
}

// New-session dialog (docs/design/next-ia/NewSession.dc.html): opened from
// the sidebar ＋. Three steps — agent picker (claude/codex/grok/kimi chips,
// plus terminal), machine list (reachable machines; production machines get
// a PROD tag and flip the auto-run default off), and a working directory
// (machine bookmarks + free-text input). Choosing `terminal` routes to the
// existing create-terminal flow; agent kinds create an agent session and
// select it. Creating is disabled when this device isn't the chosen
// machine's controller.

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AgentKind, Bookmark, MachineInfo } from "@webmux/shared";
import { X } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { listBookmarks } from "@/lib/api";
import { AgentBadge, SESSION_KIND_META, type SessionKind } from "./AgentBadge.web";

const AGENT_KINDS: AgentKind[] = ["claude", "codex", "grok", "kimi"];

export interface NewSessionRequest {
  kind: SessionKind;
  machineId: string;
  cwd: string;
  autoRun: boolean;
}

export interface NewSessionDialogProps {
  machines: MachineInfo[];
  /** machineId → online (has stats or a reachable terminal). */
  machineOnline: Record<string, boolean>;
  /** machineId → live session count (terminals + agent sessions). */
  sessionCounts: Record<string, number>;
  isControllerFor: (machineId: string) => boolean;
  /** Machine preselected when the dialog opens (the active machine). */
  initialMachineId: string | null;
  initialCwd: string | null;
  onClose: () => void;
  onCreate: (request: NewSessionRequest) => void;
}

export function NewSessionDialog({
  machines,
  machineOnline,
  sessionCounts,
  isControllerFor,
  initialMachineId,
  initialCwd,
  onClose,
  onCreate,
}: NewSessionDialogProps) {
  const [kind, setKind] = useState<SessionKind>("claude");
  const [machineId, setMachineId] = useState<string | null>(
    initialMachineId ?? machines[0]?.id ?? null,
  );
  const [cwd, setCwd] = useState(initialCwd ?? "");
  const [autoRun, setAutoRun] = useState<boolean | null>(null); // null = machine default
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const machine = machines.find((item) => item.id === machineId) ?? null;
  const online = machineId !== null && (machineOnline[machineId] ?? false);
  const effectiveAutoRun = autoRun ?? !(machine?.production ?? false);
  const canCreate =
    machineId !== null && online && cwd.trim() !== "" && isControllerFor(machineId);

  // Machine switch: re-seed the cwd and reset the auto-run override so the
  // new machine's production default applies.
  const selectMachine = useCallback(
    (id: string) => {
      setMachineId(id);
      setAutoRun(null);
      const target = machines.find((item) => item.id === id);
      setCwd((current) => current || target?.home_dir || "");
    },
    [machines],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!machineId) {
      setBookmarks([]);
      return;
    }
    let cancelled = false;
    listBookmarks(machineId)
      .then((items) => {
        if (!cancelled) setBookmarks(items);
      })
      .catch(() => {
        if (!cancelled) setBookmarks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const submit = useCallback(() => {
    if (!canCreate || machineId === null) return;
    onCreate({ kind, machineId, cwd: cwd.trim(), autoRun: effectiveAutoRun });
  }, [canCreate, machineId, kind, cwd, effectiveAutoRun, onCreate]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    },
    [onClose, submit],
  );

  const summaryKind = SESSION_KIND_META[kind].label;
  const summary = `${summaryKind} · ${machine?.name ?? "—"} · ${cwd.trim() || "—"}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: colorAlpha.overlay,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 118,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New session"
        data-testid="new-session-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: 680,
          maxWidth: "calc(100vw - 48px)",
          maxHeight: "calc(100vh - 160px)",
          overflowY: "auto",
          background: colors.bg2,
          border: `1px solid ${colors.line}`,
          borderRadius: 12,
          boxShadow: "0 14px 40px rgb(0 0 0 / 0.5)",
          color: colors.fg1,
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 46,
            padding: "0 12px 0 16px",
            borderBottom: `1px solid ${colors.lineSoft}`,
          }}
        >
          <div style={{ flexGrow: 1, fontSize: 13.5, fontWeight: 600, color: colors.fg0 }}>
            New session
          </div>
          <button
            type="button"
            data-testid="new-session-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
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
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 15 }}>
          {/* step 1: agent */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <StepLabel index={1} label="AGENT" active />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 6,
              }}
            >
              {([...AGENT_KINDS, "terminal"] as SessionKind[]).map((candidate) => {
                const selected = candidate === kind;
                const meta = SESSION_KIND_META[candidate];
                return (
                  <button
                    key={candidate}
                    type="button"
                    data-testid={`new-session-agent-${candidate}`}
                    onClick={() => setKind(candidate)}
                    style={{
                      padding: "9px 8px",
                      borderRadius: 8,
                      border: `1px solid ${selected ? colorAlpha.accentLine : colors.line}`,
                      background: selected ? colorAlpha.accentSubtle : colors.bg1,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <AgentBadge kind={candidate} />
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: selected ? 600 : 400,
                        color: selected ? colors.fg0 : colors.fg1,
                        marginTop: 7,
                      }}
                    >
                      {meta.label}
                    </div>
                  </button>
                );
              })}
            </div>

            {kind !== "terminal" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 11px",
                  borderRadius: 8,
                  border: `1px solid ${colors.line}`,
                  background: colors.bg1,
                }}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={effectiveAutoRun}
                  data-testid="new-session-autorun"
                  onClick={() => setAutoRun(!effectiveAutoRun)}
                  style={{
                    width: 28,
                    height: 16,
                    flexShrink: 0,
                    borderRadius: 999,
                    border: "none",
                    background: effectiveAutoRun ? colorAlpha.accentLine : colors.bg3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: effectiveAutoRun ? "flex-end" : "flex-start",
                    padding: "0 2px",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: effectiveAutoRun ? colors.accent : colors.fg3,
                    }}
                  />
                </button>
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: colors.fg0 }}>
                    Auto-run tools
                  </div>
                  <div style={{ fontSize: 11, color: colors.fg2, marginTop: 2 }}>
                    Tool calls run without asking.{" "}
                    <span style={{ color: colors.warn }}>PROD</span> machines default
                    this off.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* step 2: machine */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <StepLabel index={2} label="MACHINE" active />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {machines.map((item) => {
                const selected = item.id === machineId;
                const itemOnline = machineOnline[item.id] ?? false;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`new-session-machine-${item.id}`}
                    disabled={!itemOnline}
                    onClick={() => selectMachine(item.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      minHeight: 32,
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${
                        selected
                          ? item.production
                            ? "rgb(var(--color-warn) / 0.35)"
                            : colorAlpha.accentLine
                          : colors.line
                      }`,
                      background: selected
                        ? item.production
                          ? "rgb(var(--color-warn) / 0.05)"
                          : colorAlpha.accentSubtle
                        : colors.bg1,
                      cursor: itemOnline ? "pointer" : "not-allowed",
                      opacity: itemOnline ? 1 : 0.5,
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: itemOnline ? colors.ok : colors.fg3,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        width: 120,
                        flexShrink: 0,
                        fontSize: 12.5,
                        fontWeight: selected ? 500 : 400,
                        color: itemOnline
                          ? selected
                            ? colors.fg0
                            : colors.fg1
                          : colors.fg3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name}
                    </span>
                    {item.production && (
                      <span
                        data-testid={`new-session-machine-${item.id}-prod`}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: 0.4,
                          color: colors.warn,
                          border: "1px solid rgb(var(--color-warn) / 0.4)",
                          background: "rgb(var(--color-warn) / 0.1)",
                          borderRadius: 4,
                          padding: "0 4px",
                          flexShrink: 0,
                        }}
                      >
                        PROD
                      </span>
                    )}
                    <span
                      style={{
                        flexGrow: 1,
                        fontSize: 11,
                        color: colors.fg2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {item.production
                        ? "auto-run off by default"
                        : itemOnline
                          ? ""
                          : "offline"}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: colors.fg2,
                        flexShrink: 0,
                      }}
                    >
                      {sessionCounts[item.id] ?? 0} sessions
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* step 3: directory */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <StepLabel
              index={3}
              label="DIRECTORY"
              active
              suffix={machine ? `on ${machine.name}` : undefined}
            />
            <input
              ref={inputRef}
              data-testid="new-session-cwd-input"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={machine?.home_dir || "~"}
              spellCheck={false}
              style={{
                height: 34,
                padding: "0 11px",
                borderRadius: 6,
                background: colors.bg0,
                border: `1px solid ${colors.line}`,
                outline: "none",
                color: colors.fg0,
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
              }}
            />
            {bookmarks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {bookmarks.map((bookmark) => (
                  <button
                    key={bookmark.id}
                    type="button"
                    data-testid={`new-session-cwd-bookmark-${bookmark.id}`}
                    onClick={() => setCwd(bookmark.path)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      height: 30,
                      padding: "0 10px",
                      borderRadius: 6,
                      border: "none",
                      background:
                        cwd.trim() === bookmark.path ? colors.bg3 : "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        flexGrow: 1,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                        color: colors.fg1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {bookmark.path}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9.5,
                        color: colors.accent,
                        border: `1px solid ${colorAlpha.accentBorder}`,
                        borderRadius: 4,
                        padding: "1px 5px",
                        flexShrink: 0,
                      }}
                    >
                      {bookmark.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 54,
            marginTop: 15,
            padding: "0 14px 0 16px",
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg1,
          }}
        >
          <div
            data-testid="new-session-summary"
            style={{
              flexGrow: 1,
              minWidth: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: colors.fg2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {summary}
          </div>
          {machineId !== null && !isControllerFor(machineId) && (
            <div
              data-testid="new-session-not-controller"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: colors.fg3,
                flexShrink: 0,
              }}
            >
              viewing — take control to create
            </div>
          )}
          <button
            type="button"
            data-testid="new-session-submit"
            onClick={submit}
            disabled={!canCreate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 14px",
              borderRadius: 6,
              border: "none",
              background: colors.accent,
              color: colors.bg0,
              flexShrink: 0,
              cursor: canCreate ? "pointer" : "not-allowed",
              opacity: canCreate ? 1 : 0.45,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
              {kind === "terminal" ? "Create terminal" : "Create session"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.55 }}>
              ⌘↵
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function StepLabel({
  index,
  label,
  active,
  suffix,
}: {
  index: number;
  label: string;
  active: boolean;
  suffix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: 999,
          background: active ? colorAlpha.accentSoft : colors.bg2,
          border: `1px solid ${active ? colorAlpha.accentLine : colors.line}`,
          color: active ? colors.accent : colors.fg3,
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {index}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.1,
          color: active ? colors.accent : colors.fg3,
        }}
      >
        {label}
      </span>
      {suffix && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: colors.fg3 }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

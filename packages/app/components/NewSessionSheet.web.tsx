// Mobile new-session sheet (docs/design/next-ia/MobileNew.dc.html): the
// bottom-sheet variant of the desktop new-session panel, opened from the
// mobile title-bar ＋. Same one-screen prefilled flow — agent chips with the
// remembered kind preselected, a model dropdown per agent kind (live
// sessions, else the persisted cache; empty → hint), the working directory
// (recent cwds, bookmarks, free text; machine picker only when >1 machine is
// online), and a single-line auto-run toggle. All state/validation comes
// from useNewSessionState, shared with NewSessionDialog. The terminal chip
// hides the model/auto-run rows and routes to the mobile create-terminal
// flow (current group's placement, overflow-into-new-tab) in the canvas.

import { useEffect } from "react";
import type {
  AgentSessionInfo,
  MachineInfo,
  TerminalInfo,
} from "@offdesk/shared";
import { X } from "lucide-react";
import { colors, colorAlpha } from "@/lib/colors";
import { AgentBadge, SESSION_KIND_META, type SessionKind } from "./AgentBadge.web";
import {
  NEW_SESSION_AGENT_KINDS,
  useNewSessionState,
  type NewSessionRequest,
} from "./newSessionState";

export interface NewSessionSheetProps {
  machines: MachineInfo[];
  machineOnline: Record<string, boolean>;
  sessionCounts: Record<string, number>;
  isControllerFor: (machineId: string) => boolean;
  initialMachineId: string | null;
  initialCwd: string | null;
  agentSessions: AgentSessionInfo[];
  terminals: TerminalInfo[];
  onClose: () => void;
  onCreate: (request: NewSessionRequest) => void;
}

export function NewSessionSheet({
  machines,
  machineOnline,
  sessionCounts,
  isControllerFor,
  initialMachineId,
  initialCwd,
  agentSessions,
  terminals,
  onClose,
  onCreate,
}: NewSessionSheetProps) {
  const {
    kind,
    selectKind,
    modelId,
    setModelId,
    machineId,
    selectMachine,
    machine,
    onlineMachines,
    cwd,
    setCwd,
    effectiveAutoRun,
    setAutoRun,
    isAgent,
    canCreate,
    modelOptions,
    recentCwds,
    visibleBookmarks,
    submit,
  } = useNewSessionState({
    machines,
    machineOnline,
    isControllerFor,
    initialMachineId,
    initialCwd,
    agentSessions,
    terminals,
    onCreate,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = `${SESSION_KIND_META[kind].label} · ${machine?.name ?? "—"} · ${cwd.trim() || "—"}`;

  return (
    <div
      data-testid="mobile-new-session-sheet"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: colorAlpha.overlay,
        display: "flex",
        alignItems: "flex-end",
        animation: "offdeskFadeIn 120ms ease-out",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New session"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "85%",
          display: "flex",
          flexDirection: "column",
          background: colors.bg2,
          borderTop: `1px solid ${colors.line}`,
          borderTopLeftRadius: 13,
          borderTopRightRadius: 13,
          boxShadow: "0 -14px 40px rgb(0 0 0 / 0.5)",
          color: colors.fg1,
          animation: "offdeskSlideUp 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            height: 20,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
        <div
          style={{
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 6px 0 16px",
            borderBottom: `1px solid ${colors.lineSoft}`,
          }}
        >
          <div style={{ flexGrow: 1, fontSize: 15, fontWeight: 600, color: colors.fg0 }}>
            New session
          </div>
          <button
            type="button"
            data-testid="mobile-new-session-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            style={{
              width: 44,
              height: 44,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: colors.fg2,
              padding: 0,
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            flexGrow: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "14px 0 4px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* agent chips */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SheetLabel label="AGENT" />
            <div
              style={{
                display: "flex",
                gap: 7,
                padding: "0 16px",
                overflowX: "auto",
              }}
            >
              {([...NEW_SESSION_AGENT_KINDS, "terminal"] as SessionKind[]).map(
                (candidate) => {
                  const selected = candidate === kind;
                  const meta = SESSION_KIND_META[candidate];
                  return (
                    <button
                      key={candidate}
                      type="button"
                      data-testid={`mobile-new-session-agent-${candidate}`}
                      onClick={() => selectKind(candidate)}
                      style={{
                        width: 84,
                        flexShrink: 0,
                        padding: "9px 10px",
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
                },
              )}
            </div>
          </div>

          {/* model (agent sessions only) */}
          {isAgent && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SheetLabel label="MODEL" />
              {modelOptions.length > 0 ? (
                <select
                  data-testid="mobile-new-session-model-select"
                  value={modelId ?? ""}
                  onChange={(event) =>
                    setModelId(event.target.value === "" ? null : event.target.value)
                  }
                  style={{
                    height: 44,
                    margin: "0 16px",
                    padding: "0 11px",
                    borderRadius: 8,
                    background: colors.bg0,
                    border: `1px solid ${colors.line}`,
                    outline: "none",
                    color: colors.fg0,
                    fontSize: 13,
                  }}
                >
                  <option value="">Agent default</option>
                  {modelOptions.map((model) => (
                    <option key={model.model_id} value={model.model_id}>
                      {model.name || model.model_id}
                    </option>
                  ))}
                  {modelId !== null &&
                    !modelOptions.some((model) => model.model_id === modelId) && (
                      <option value={modelId}>{modelId}</option>
                    )}
                </select>
              ) : (
                <div
                  data-testid="mobile-new-session-model-hint"
                  style={{ padding: "0 16px", fontSize: 11.5, color: colors.fg3 }}
                >
                  模型在会话内可切换
                </div>
              )}
            </div>
          )}

          {/* directory */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SheetLabel
              label="DIRECTORY"
              suffix={machine ? `on ${machine.name}` : undefined}
            />
            <input
              data-testid="mobile-new-session-cwd-input"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={machine?.home_dir || "~"}
              spellCheck={false}
              style={{
                height: 44,
                margin: "0 16px",
                padding: "0 12px",
                borderRadius: 8,
                background: colors.bg0,
                border: `1px solid ${colors.line}`,
                outline: "none",
                color: colors.fg0,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
              }}
            />
            {recentCwds.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "0 16px",
                }}
              >
                {recentCwds.map((path, index) => (
                  <CwdRow
                    key={path}
                    testId={`mobile-new-session-cwd-recent-${index}`}
                    path={path}
                    selected={false}
                    onPick={() => setCwd(path)}
                  />
                ))}
              </div>
            )}
            {visibleBookmarks.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "0 16px",
                }}
              >
                {visibleBookmarks.map((bookmark) => (
                  <CwdRow
                    key={bookmark.id}
                    testId={`mobile-new-session-cwd-bookmark-${bookmark.id}`}
                    path={bookmark.path}
                    badge={bookmark.label}
                    selected={cwd.trim() === bookmark.path}
                    onPick={() => setCwd(bookmark.path)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* machine picker — only when a choice actually exists */}
          {onlineMachines.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SheetLabel label="MACHINE" />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "0 16px",
                }}
              >
                {machines.map((item) => {
                  const selected = item.id === machineId;
                  const itemOnline = machineOnline[item.id] ?? false;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`mobile-new-session-machine-${item.id}`}
                      disabled={!itemOnline}
                      onClick={() => selectMachine(item.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minHeight: 44,
                        padding: "4px 12px",
                        borderRadius: 8,
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
                      <span style={{ flexGrow: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13,
                            fontWeight: selected ? 600 : 400,
                            color: itemOnline
                              ? selected
                                ? colors.fg0
                                : colors.fg1
                              : colors.fg3,
                          }}
                        >
                          {item.name}
                          {item.production && (
                            <span
                              data-testid={`mobile-new-session-machine-${item.id}-prod`}
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
                        </span>
                        <span
                          style={{
                            display: "block",
                            marginTop: 2,
                            fontSize: 10,
                            color: item.production ? colors.warn : colors.fg3,
                          }}
                        >
                          {item.production
                            ? "auto-run off by default"
                            : itemOnline
                              ? ""
                              : "offline"}
                        </span>
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
          )}

          {/* auto-run, one line (agent sessions only) */}
          {isAgent && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: 44,
                margin: "0 16px",
                padding: "6px 11px",
                borderRadius: 8,
                border: `1px solid ${colors.line}`,
                background: colors.bg1,
              }}
            >
              <button
                type="button"
                role="switch"
                aria-checked={effectiveAutoRun}
                data-testid="mobile-new-session-autorun"
                onClick={() => setAutoRun(!effectiveAutoRun)}
                style={{
                  width: 30,
                  height: 18,
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
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: effectiveAutoRun ? colors.accent : colors.fg3,
                  }}
                />
              </button>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: colors.fg0 }}>
                Auto-run tools
              </div>
              {machine?.production && (
                <div style={{ fontSize: 11, color: colors.warn }}>
                  PROD machines default this off
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            flexShrink: 0,
            padding: `10px 16px calc(10px + env(safe-area-inset-bottom))`,
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg1,
          }}
        >
          {machineId !== null && !isControllerFor(machineId) && (
            <div
              data-testid="mobile-new-session-not-controller"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: colors.fg3,
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              viewing — take control to create
            </div>
          )}
          <button
            type="button"
            data-testid="mobile-new-session-submit"
            onClick={submit}
            disabled={!canCreate}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              height: 48,
              borderRadius: 10,
              border: "none",
              background: colors.accent,
              color: colors.bg0,
              fontSize: 14,
              fontWeight: 600,
              cursor: canCreate ? "pointer" : "not-allowed",
              opacity: canCreate ? 1 : 0.45,
            }}
          >
            {kind === "terminal" ? "Create terminal" : "Create session"}
          </button>
          <div
            data-testid="mobile-new-session-summary"
            style={{
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: colors.fg3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {summary}
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetLabel({ label, suffix }: { label: string; suffix?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 16px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.1,
          color: colors.fg3,
        }}
      >
        {label}
      </span>
      {suffix && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: colors.fg3,
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

function CwdRow({
  testId,
  path,
  badge,
  selected,
  onPick,
}: {
  testId: string;
  path: string;
  badge?: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onPick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 44,
        padding: "0 12px",
        borderRadius: 8,
        border: "none",
        background: selected ? colors.bg3 : "transparent",
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
        {path}
      </span>
      {badge && (
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
          {badge}
        </span>
      )}
    </button>
  );
}

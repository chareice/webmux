// New-session panel (docs/design/next-ia/NewSession.dc.html): opened from the
// sidebar brand-row ＋. One compact panel, everything visible, prefilled from
// the remembered defaults (last-used agent/model/auto-run, per-machine last
// cwd) so plain Enter creates immediately — the panel only exists for
// overrides; the project-level ＋ menu creates without it.
//
// Rows: agent chips (claude/codex/grok/kimi/terminal), a model dropdown for
// agent kinds (populated from that agent's last-seen available_models; empty
// → hidden with a hint), the working directory (recent cwds, then bookmarks,
// then free text), and a single-line auto-run toggle. The machine picker only
// renders when more than one machine is online. Choosing `terminal` routes to
// the existing create-terminal flow and hides the model/auto-run rows.

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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

// Re-exported so existing imports from this module keep working.
export type { NewSessionRequest } from "./newSessionState";

export interface NewSessionDialogProps {
  machines: MachineInfo[];
  /** machineId → online (has stats or a reachable terminal). */
  machineOnline: Record<string, boolean>;
  /** machineId → live session count (terminals + agent sessions). */
  sessionCounts: Record<string, number>;
  isControllerFor: (machineId: string) => boolean;
  /** Machine preselected when the panel opens (the active machine). */
  initialMachineId: string | null;
  initialCwd: string | null;
  /** Existing sessions/terminals feed the recent-cwd row and, for agent
   *  kinds, the model dropdown (newest sessions carry the freshest list). */
  agentSessions: AgentSessionInfo[];
  terminals: TerminalInfo[];
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
  agentSessions,
  terminals,
  onClose,
  onCreate,
}: NewSessionDialogProps) {
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Enter") return;
      // Buttons and the model select keep their own Enter behavior.
      const target = event.target as HTMLElement;
      if (target.tagName === "BUTTON" || target.tagName === "SELECT") return;
      if (event.metaKey || event.ctrlKey || !event.shiftKey) {
        // Plain Enter (and ⌘↵) creates: everything is prefilled.
        event.preventDefault();
        submit();
      }
    },
    [onClose, submit],
  );

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
          width: 560,
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

        <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* agent chips */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <RowLabel label="AGENT" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 6,
              }}
            >
              {([...NEW_SESSION_AGENT_KINDS, "terminal"] as SessionKind[]).map((candidate) => {
                const selected = candidate === kind;
                const meta = SESSION_KIND_META[candidate];
                return (
                  <button
                    key={candidate}
                    type="button"
                    data-testid={`new-session-agent-${candidate}`}
                    onClick={() => selectKind(candidate)}
                    style={{
                      padding: "7px 8px",
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
                        marginTop: 5,
                      }}
                    >
                      {meta.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* model (agent sessions only) */}
          {isAgent && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <RowLabel label="MODEL" />
              {modelOptions.length > 0 ? (
                <select
                  data-testid="new-session-model-select"
                  value={modelId ?? ""}
                  onChange={(event) =>
                    setModelId(event.target.value === "" ? null : event.target.value)
                  }
                  style={{
                    height: 32,
                    padding: "0 9px",
                    borderRadius: 6,
                    background: colors.bg0,
                    border: `1px solid ${colors.line}`,
                    outline: "none",
                    color: colors.fg0,
                    fontSize: 12.5,
                  }}
                >
                  <option value="">Agent default</option>
                  {modelOptions.map((model) => (
                    <option key={model.model_id} value={model.model_id}>
                      {model.name || model.model_id}
                    </option>
                  ))}
                  {/* A remembered model the agent no longer lists stays
                      selectable (and visible) rather than silently dropping. */}
                  {modelId !== null &&
                    !modelOptions.some((model) => model.model_id === modelId) && (
                      <option value={modelId}>{modelId}</option>
                    )}
                </select>
              ) : (
                <div
                  data-testid="new-session-model-hint"
                  style={{ fontSize: 11.5, color: colors.fg3 }}
                >
                  模型在会话内可切换
                </div>
              )}
            </div>
          )}

          {/* directory + machine */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <RowLabel
              label="DIRECTORY"
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
            {recentCwds.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {recentCwds.map((path, index) => (
                  <CwdRowButton
                    key={path}
                    testId={`new-session-cwd-recent-${index}`}
                    path={path}
                    selected={false}
                    onPick={() => setCwd(path)}
                  />
                ))}
              </div>
            )}
            {visibleBookmarks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {visibleBookmarks.map((bookmark) => (
                  <CwdRowButton
                    key={bookmark.id}
                    testId={`new-session-cwd-bookmark-${bookmark.id}`}
                    path={bookmark.path}
                    badge={bookmark.label}
                    selected={cwd.trim() === bookmark.path}
                    onPick={() => setCwd(bookmark.path)}
                  />
                ))}
              </div>
            )}

            {/* machine picker — only when a choice actually exists */}
            {onlineMachines.length > 1 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  marginTop: 4,
                }}
              >
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
                        minHeight: 30,
                        padding: "3px 10px",
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
                        {itemOnline ? "" : "offline"}
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
            )}
          </div>

          {/* auto-run, one line (agent sessions only) */}
          {isAgent && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
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
              <div style={{ fontSize: 12, fontWeight: 500, color: colors.fg0 }}>
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
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 54,
            marginTop: 14,
            padding: "0 14px 0 16px",
            borderTop: `1px solid ${colors.lineSoft}`,
            background: colors.bg1,
          }}
        >
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            {machineId !== null && !isControllerFor(machineId) && (
              <div
                data-testid="new-session-not-controller"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: colors.fg3,
                }}
              >
                viewing — take control to create
              </div>
            )}
          </div>
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
              ↵
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RowLabel({ label, suffix }: { label: string; suffix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: colors.fg3 }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function CwdRowButton({
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
        gap: 9,
        height: 28,
        padding: "0 10px",
        borderRadius: 6,
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

import { memo, useEffect, useState } from "react";
import type { Bookmark, MachineInfo } from "@webmux/shared";
import { getSettings } from "@/lib/api";
import { colors } from "@/lib/colors";
import { PathInput } from "./PathInput.web";

interface QuickCommand {
  label: string;
  command: string;
}

interface WorkpathOverlayProps {
  machine: MachineInfo;
  // Bookmarks are owned by the parent (TerminalCanvas) so the rail's
  // counts and the overlay's list never drift. Add/remove go through the
  // parent-supplied callbacks; this component is purely presentational
  // for the bookmark list.
  bookmarks: Bookmark[];
  selectedWorkpathId: string | "all";
  terminalCountsByBookmarkId: Record<string, number>;
  liveByBookmarkId: Record<string, boolean>;
  canCreateTerminal: boolean;
  // Whether to show the "add directory" PathInput. Controlled by parent
  // so the rail's "+" button can open it (along with force-expanding the
  // overlay) and so a successful add can close it from any source.
  addDirectoryOpen: boolean;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onShowAddDirectory: () => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onCancelAddDirectory: () => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

function WorkpathOverlayComponent(props: WorkpathOverlayProps) {
  const {
    machine,
    bookmarks,
    selectedWorkpathId,
    terminalCountsByBookmarkId,
    liveByBookmarkId,
    canCreateTerminal,
    addDirectoryOpen,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onShowAddDirectory,
    onConfirmAddDirectory,
    onCancelAddDirectory,
    onRemoveBookmark,
    onPointerEnter,
    onPointerLeave,
  } = props;

  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);

  useEffect(() => {
    getSettings()
      .then((res) => {
        try {
          setQuickCommands(JSON.parse(res.settings.quick_commands || "[]"));
        } catch {
          /* ignore */
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  const handleAdd = (path: string) => {
    if (!path) return;
    if (bookmarks.some((b) => b.path === path)) {
      onCancelAddDirectory();
      return;
    }
    onConfirmAddDirectory(machine.id, path);
  };

  return (
    <div
      data-testid="workpath-overlay"
      onPointerLeave={onPointerLeave}
      style={{
        position: "absolute",
        left: 56,
        top: 0,
        bottom: 0,
        width: 240,
        background: colors.backgroundSecondary,
        borderRight: `1px solid ${colors.border}`,
        boxShadow: "6px 0 20px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        zIndex: 40,
      }}
    >
      <div
        style={{
          padding: 12,
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              color: colors.foregroundMuted,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Machine
          </div>
          <div style={{ fontSize: 12, color: colors.foreground }}>
            {machine.name} · {machine.os}
          </div>
        </div>
      </div>

      {!canCreateTerminal && onRequestControl && (
        <div style={{ padding: 10 }}>
          <button
            data-testid={`overlay-request-control-${machine.id}`}
            onClick={() => onRequestControl(machine.id)}
            style={{
              background: colors.accent,
              color: colors.background,
              border: "none",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 10px",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Control Here
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* All row */}
        <button
          data-testid="overlay-select-all"
          onClick={onSelectAll}
          style={rowStyle(selectedWorkpathId === "all")}
        >
          <span style={{ color: colors.foreground, fontSize: 12 }}>All</span>
        </button>

        <div style={{ height: 1, background: colors.border, margin: "4px 12px" }} />

        {bookmarks.map((bm) => {
          const selected = selectedWorkpathId === bm.id;
          const count = terminalCountsByBookmarkId[bm.id] ?? 0;
          const live = liveByBookmarkId[bm.id] ?? false;
          const visibleCmds = quickCommands.filter((c) => c.label && c.command);
          return (
            <div key={bm.id} style={{ ...rowStyle(selected), paddingBottom: 8 }}>
              <button
                data-testid={`overlay-bookmark-${bm.id}`}
                onClick={() => {
                  if (!canCreateTerminal && count === 0) return;
                  if (count === 0) {
                    onCreateTerminal(machine.id, bm.path);
                  } else {
                    onSelectWorkpath(bm.id);
                  }
                }}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  alignItems: "center",
                }}
              >
                <span style={{ color: selected ? colors.accent : colors.foreground, fontSize: 12, fontWeight: selected ? 600 : 400 }}>
                  {bm.label}
                </span>
                <span style={{ color: colors.foregroundMuted, fontSize: 10 }}>
                  {count > 0 ? `${count} ${live ? "●" : ""}` : ""}
                </span>
              </button>
              <div style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 1 }}>
                {bm.path}
              </div>
              {canCreateTerminal && visibleCmds.length > 0 && (
                <div style={{ display: "flex", gap: 3, marginTop: 4, flexWrap: "wrap" }}>
                  {visibleCmds.map((cmd) => (
                    <button
                      key={cmd.label}
                      data-testid={`overlay-quick-cmd-${bm.id}-${cmd.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateTerminal(machine.id, bm.path, cmd.command);
                      }}
                      style={{
                        background: "rgba(217, 119, 87, 0.12)",
                        color: colors.accent,
                        border: "none",
                        borderRadius: 3,
                        fontSize: 9,
                        padding: "1px 5px",
                        cursor: "pointer",
                      }}
                    >
                      {cmd.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                data-testid={`overlay-remove-${bm.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBookmark(bm.id);
                }}
                style={{
                  position: "absolute",
                  right: 8,
                  top: 4,
                  background: "none",
                  border: "none",
                  color: colors.foregroundMuted,
                  cursor: "pointer",
                  fontSize: 10,
                }}
                aria-label="Remove bookmark"
              >
                &#x2715;
              </button>
            </div>
          );
        })}

        {addDirectoryOpen ? (
          <PathInput
            machineId={machine.id}
            onSubmit={handleAdd}
            onCancel={onCancelAddDirectory}
          />
        ) : (
          <button
            data-testid="overlay-add-directory"
            onClick={onShowAddDirectory}
            style={{
              background: "none",
              border: "none",
              color: colors.foregroundMuted,
              cursor: "pointer",
              padding: "8px 12px",
              fontSize: 11,
              textAlign: "left",
              width: "100%",
            }}
          >
            + Add directory
          </button>
        )}
      </div>
    </div>
  );
}

function rowStyle(selected: boolean): React.CSSProperties {
  return {
    position: "relative",
    padding: "8px 12px",
    background: selected ? "rgba(217, 119, 87, 0.08)" : "transparent",
    borderLeft: selected ? `2px solid ${colors.accent}` : "2px solid transparent",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    textAlign: "left",
  };
}

export const WorkpathOverlay = memo(WorkpathOverlayComponent);

import { memo, useEffect, useRef, useState } from "react";
import type { Bookmark, MachineInfo } from "@webmux/shared";
import {
  listBookmarks,
  createBookmark,
  deleteBookmark,
  getSettings,
} from "@/lib/api";
import { colors } from "@/lib/colors";
import { PathInput } from "./PathInput.web";

interface QuickCommand {
  label: string;
  command: string;
}

interface WorkpathOverlayProps {
  machine: MachineInfo;
  selectedWorkpathId: string | "all";
  terminalCountsByBookmarkId: Record<string, number>;
  liveByBookmarkId: Record<string, boolean>;
  canCreateTerminal: boolean;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onBookmarkDeleted?: (bookmarkId: string) => void;
  onPointerLeave: () => void;
}

function WorkpathOverlayComponent(props: WorkpathOverlayProps) {
  const {
    machine,
    selectedWorkpathId,
    terminalCountsByBookmarkId,
    liveByBookmarkId,
    canCreateTerminal,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onBookmarkDeleted,
    onPointerLeave,
  } = props;

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [quickCommands, setQuickCommands] = useState<QuickCommand[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    listBookmarks(machine.id)
      .then((bms) => {
        if (bms.length === 0) {
          const homeDir = machine.home_dir || "/home";
          setBookmarks([{
            id: "local-home",
            machineId: machine.id,
            path: homeDir,
            label: "~",
            sortOrder: 0,
          }]);
        } else {
          setBookmarks(bms);
        }
      })
      .catch(() => {
        const homeDir = machine.home_dir || "/home";
        setBookmarks([{
          id: "local-home",
          machineId: machine.id,
          path: homeDir,
          label: "~",
          sortOrder: 0,
        }]);
      });
  }, [machine.id, machine.home_dir]);

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

  const handleAdd = async (path: string) => {
    if (!path) return;
    if (bookmarks.some((b) => b.path === path)) {
      setShowAdd(false);
      return;
    }
    try {
      const bm = await createBookmark(machine.id, path, pathLabel(path));
      setBookmarks((prev) => [...prev, bm]);
    } catch {
      setBookmarks((prev) => [...prev, {
        id: `local-${Date.now()}`,
        machineId: machine.id,
        path,
        label: pathLabel(path),
        sortOrder: prev.length,
      }]);
    }
    setShowAdd(false);
  };

  const handleRemove = async (bm: Bookmark) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== bm.id));
    try {
      await deleteBookmark(bm.id);
    } catch { /* ignore */ }
    onBookmarkDeleted?.(bm.id);
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
                  handleRemove(bm);
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

        {showAdd ? (
          <PathInput
            machineId={machine.id}
            onSubmit={handleAdd}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button
            data-testid="overlay-add-directory"
            onClick={() => setShowAdd(true)}
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

function pathLabel(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export const WorkpathOverlay = memo(WorkpathOverlayComponent);

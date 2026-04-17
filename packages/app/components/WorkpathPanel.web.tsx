import { memo, useState } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { Plus, Settings, X } from "lucide-react";
import { colors } from "@/lib/colors";
import { PathInput } from "./PathInput.web";

interface WorkpathPanelProps {
  machine: MachineInfo;
  // True when this user holds the device's machine lease — gates "Control Here".
  canCreateTerminal: boolean;
  // True when only one machine is registered → render footer actions here
  // instead of relying on the (hidden) ActivityBar.
  singleMachine: boolean;
  bookmarks: Bookmark[];
  selectedWorkpathId: string | "all";
  terminals: TerminalInfo[];
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onOpenSettings: () => void;
}

function matchBookmark(bm: Bookmark, t: TerminalInfo): boolean {
  return t.machine_id === bm.machine_id && t.cwd === bm.path;
}

function WorkpathPanelComponent(props: WorkpathPanelProps) {
  const {
    machine,
    canCreateTerminal,
    singleMachine,
    bookmarks,
    selectedWorkpathId,
    terminals,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onConfirmAddDirectory,
    onRemoveBookmark,
    onOpenSettings,
  } = props;

  // Owned locally — opening / closing the inline PathInput is a panel
  // concern, not a TerminalCanvas concern. Lifted before (PR #137) only to
  // share with the rail "+", which no longer exists.
  const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);

  const machineBookmarks = bookmarks.filter((b) => b.machine_id === machine.id);
  const totalCount = terminals.filter((t) => t.machine_id === machine.id).length;

  const handleAdd = (path: string) => {
    if (!path) {
      setAddDirectoryOpen(false);
      return;
    }
    if (machineBookmarks.some((b) => b.path === path)) {
      setAddDirectoryOpen(false);
      return;
    }
    onConfirmAddDirectory(machine.id, path);
    setAddDirectoryOpen(false);
  };

  return (
    <div
      data-testid="workpath-panel"
      style={{
        width: 220,
        minWidth: 220,
        flexShrink: 0,
        background: colors.backgroundSecondary,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: colors.foregroundMuted,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {singleMachine ? "Workpaths" : "Machine"}
        </div>
        {!singleMachine && (
          <div style={{ fontSize: 12, color: colors.foreground, marginTop: 2 }}>
            {machine.name} · {machine.os}
          </div>
        )}
      </div>

      {!canCreateTerminal && onRequestControl && (
        <div style={{ padding: 10 }}>
          <button
            data-testid={`panel-request-control-${machine.id}`}
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
        <button
          data-testid="panel-select-all"
          onClick={onSelectAll}
          style={rowStyle(selectedWorkpathId === "all")}
        >
          <span style={{ color: colors.foreground, fontSize: 12 }}>All</span>
          {totalCount > 0 && (
            <span style={{ color: colors.foregroundMuted, fontSize: 10 }}>{totalCount}</span>
          )}
        </button>

        <div style={{ height: 1, background: colors.border, margin: "4px 12px" }} />

        {machineBookmarks.map((bm) => {
          const selected = selectedWorkpathId === bm.id;
          const count = terminals.filter((t) => matchBookmark(bm, t)).length;
          const live = count > 0;
          return (
            <div key={bm.id} style={{ ...rowStyle(selected), paddingBottom: 8, position: "relative" }}>
              <button
                data-testid={`panel-bookmark-${bm.id}`}
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
                  flexDirection: "column",
                  width: "100%",
                  alignItems: "stretch",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span
                    style={{
                      color: selected ? colors.accent : colors.foreground,
                      fontSize: 12,
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {bm.label}
                  </span>
                  <span style={{ color: colors.foregroundMuted, fontSize: 10 }}>
                    {count > 0 ? `${count} ${live ? "●" : ""}` : ""}
                  </span>
                </div>
                <div style={{ color: colors.foregroundMuted, fontSize: 10, marginTop: 1 }}>
                  {bm.path}
                </div>
              </button>
              <button
                data-testid={`panel-remove-${bm.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveBookmark(bm.id);
                }}
                style={{
                  position: "absolute",
                  right: 8,
                  top: 6,
                  background: "none",
                  border: "none",
                  color: colors.foregroundMuted,
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label="Remove bookmark"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}

        {addDirectoryOpen ? (
          <PathInput
            machineId={machine.id}
            onSubmit={handleAdd}
            onCancel={() => setAddDirectoryOpen(false)}
          />
        ) : (
          <button
            data-testid="panel-add-directory"
            onClick={() => setAddDirectoryOpen(true)}
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

      {singleMachine && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 4,
            padding: "6px 10px",
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <button
            data-testid="panel-add-bookmark"
            onClick={() => setAddDirectoryOpen(true)}
            title="Add directory"
            style={iconBtn}
            aria-label="Add directory"
          >
            <Plus size={14} />
          </button>
          <button
            data-testid="panel-open-settings"
            onClick={onOpenSettings}
            title="Settings"
            style={iconBtn}
            aria-label="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function rowStyle(selected: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    background: selected ? "rgba(217, 119, 87, 0.08)" : "transparent",
    borderLeft: selected ? `2px solid ${colors.accent}` : "2px solid transparent",
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textAlign: "left",
  };
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: colors.foregroundMuted,
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const WorkpathPanel = memo(WorkpathPanelComponent);

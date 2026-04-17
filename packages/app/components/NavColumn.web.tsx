import { memo } from "react";
import type { Bookmark, MachineInfo, TerminalInfo } from "@webmux/shared";
import { ActivityBar } from "./ActivityBar.web";
import { WorkpathPanel } from "./WorkpathPanel.web";

interface NavColumnProps {
  machines: MachineInfo[];
  activeMachineId: string | null;
  bookmarks: Bookmark[];
  terminals: TerminalInfo[];
  selectedWorkpathId: string | "all";
  panelOpen: boolean;
  canCreateTerminalForActiveMachine: boolean;
  onSelectMachine: (id: string) => void;
  onSelectAll: () => void;
  onSelectWorkpath: (id: string) => void;
  onCreateTerminal: (machineId: string, cwd: string, startupCommand?: string) => void;
  onRequestControl?: (machineId: string) => void;
  onConfirmAddDirectory: (machineId: string, path: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onOpenSettings: () => void;
}

function NavColumnComponent(props: NavColumnProps) {
  const {
    machines,
    activeMachineId,
    bookmarks,
    terminals,
    selectedWorkpathId,
    panelOpen,
    canCreateTerminalForActiveMachine,
    onSelectMachine,
    onSelectAll,
    onSelectWorkpath,
    onCreateTerminal,
    onRequestControl,
    onConfirmAddDirectory,
    onRemoveBookmark,
    onOpenSettings,
  } = props;

  const activeMachine =
    machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;

  if (!activeMachine) return null;

  const singleMachine = machines.length <= 1;

  // The panel can be hidden via Cmd+B; the activity bar (when present)
  // stays visible regardless. With single-machine the activity bar is
  // hidden too — when panelOpen is false there's no nav surface visible.
  return (
    <div
      data-testid="nav-column"
      style={{ display: "flex", height: "100%" }}
    >
      <ActivityBar
        machines={machines}
        activeMachineId={activeMachineId}
        onSelectMachine={onSelectMachine}
        onAddBookmark={() => {/* opening add-directory is handled by panel directly */}}
        onOpenSettings={onOpenSettings}
      />
      {panelOpen && (
        <WorkpathPanel
          machine={activeMachine}
          canCreateTerminal={canCreateTerminalForActiveMachine}
          singleMachine={singleMachine}
          bookmarks={bookmarks}
          selectedWorkpathId={selectedWorkpathId}
          terminals={terminals}
          onSelectAll={onSelectAll}
          onSelectWorkpath={onSelectWorkpath}
          onCreateTerminal={onCreateTerminal}
          onRequestControl={onRequestControl}
          onConfirmAddDirectory={onConfirmAddDirectory}
          onRemoveBookmark={onRemoveBookmark}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
}

export const NavColumn = memo(NavColumnComponent);

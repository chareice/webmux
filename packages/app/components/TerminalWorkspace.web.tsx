import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TerminalInfo, WorkspaceGroupInfo } from "@webmux/shared";
import {
  ChevronDown,
  Columns2,
  Expand,
  GripVertical,
  Maximize2,
  Minimize2,
  PanelBottom,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { TerminalCard, type TerminalCardRef } from "./TerminalCard.web";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
import {
  type WorkspaceGroup,
  type WorkspacePaneNode,
  type WorkspaceSplitIntent,
  appendWorkspacePaneToGroup,
  closeWorkspacePane,
  createTerminalWorkspace,
  getActiveWorkspaceGroup,
  reconcileTerminalWorkspace,
  selectWorkspaceGroup,
  splitWorkspacePane,
} from "@/lib/terminalWorkspaceLayout";

interface TerminalWorkspaceProps {
  terminal: TerminalInfo;
  siblings: TerminalInfo[];
  workspaceGroups: WorkspaceGroupInfo[];
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onSplit: (
    terminal: TerminalInfo,
    direction: WorkspaceSplitIntent,
  ) => Promise<TerminalInfo | null>;
  onCreatePane: (input: {
    machineId: string;
    cwd: string;
    workspaceGroupId: string | null;
  }) => Promise<TerminalInfo | null>;
  onCreateGroup: (
    machineId: string,
    name: string,
  ) => Promise<WorkspaceGroupInfo | null | void>;
  onReorderGroups: (
    machineId: string,
    groupIds: string[],
  ) => Promise<WorkspaceGroupInfo[] | null | void>;
  onDeleteGroup: (machineId: string, groupId: string) => Promise<void>;
  onAssignGroup: (
    terminal: TerminalInfo,
    workspaceGroupId: string | null,
  ) => Promise<void>;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

function TerminalWorkspaceComponent({
  terminal,
  siblings,
  workspaceGroups,
  isController,
  deviceId,
  isMobile,
  onClose,
  onPick,
  onDestroy,
  onSplit,
  onCreatePane,
  onCreateGroup,
  onReorderGroups,
  onDeleteGroup,
  onAssignGroup,
  onRequestControl,
  onReleaseControl,
}: TerminalWorkspaceProps) {
  const [workspace, setWorkspace] = useState(() =>
    createTerminalWorkspace(siblings, terminal.id, workspaceGroups),
  );
  const activeCardRef = useRef<TerminalCardRef | null>(null);
  const fitRequestCounterRef = useRef(0);
  const [fitRequest, setFitRequest] = useState<{
    terminalId: string;
    nonce: number;
  } | null>(null);
  const [maximizedTerminalId, setMaximizedTerminalId] = useState<string | null>(
    null,
  );
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [deleteGroup, setDeleteGroup] = useState<WorkspaceGroup | null>(null);
  const terminalsById = useMemo(() => {
    const map = new Map<string, TerminalInfo>();
    for (const sibling of siblings) map.set(sibling.id, sibling);
    return map;
  }, [siblings]);

  const previousTerminalIdRef = useRef(terminal.id);
  useEffect(() => {
    const externalTerminalChanged = previousTerminalIdRef.current !== terminal.id;
    previousTerminalIdRef.current = terminal.id;
    setWorkspace((prev) =>
      reconcileTerminalWorkspace(
        prev,
        siblings,
        externalTerminalChanged ? terminal.id : prev.activeTerminalId,
        workspaceGroups,
      ),
    );
  }, [siblings, terminal.id, workspaceGroups]);

  const activeGroup = getActiveWorkspaceGroup(workspace);
  const activeTerminal = workspace.activeTerminalId
    ? terminalsById.get(workspace.activeTerminalId) ?? null
    : null;
  const commandMachineId = activeTerminal?.machine_id ?? terminal.machine_id;

  const requestPaneFit = useCallback((terminalId: string | null) => {
    if (!terminalId) return;
    fitRequestCounterRef.current += 1;
    setFitRequest({
      terminalId,
      nonce: fitRequestCounterRef.current,
    });
  }, []);
  const handleFitRequestHandled = useCallback((nonce: number) => {
    setFitRequest((current) =>
      current?.nonce === nonce ? null : current,
    );
  }, []);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      const changedTerminal = terminalId !== workspace.activeTerminalId;
      if (changedTerminal) setMaximizedTerminalId(null);
      setWorkspace((prev) => {
        const group =
          prev.groups.find((candidate) =>
            containsTerminal(candidate.root, terminalId),
          ) ?? null;
        return {
          ...prev,
          activeGroupId: group?.id ?? prev.activeGroupId,
          activeTerminalId: terminalId,
        };
      });
      onPick(terminalId);
      if (!isMobile && isController && changedTerminal) {
        requestPaneFit(terminalId);
      }
    },
    [
      isController,
      isMobile,
      onPick,
      requestPaneFit,
      workspace.activeTerminalId,
    ],
  );

  const activateGroup = useCallback(
    (groupId: string) => {
      setMaximizedTerminalId(null);
      const next = selectWorkspaceGroup(workspace, groupId);
      setWorkspace(next);
      if (next.activeTerminalId) onPick(next.activeTerminalId);
      if (!isMobile && isController) requestPaneFit(next.activeTerminalId);
    },
    [isController, isMobile, onPick, requestPaneFit, workspace],
  );

  const handleSplit = useCallback(
    async (direction: WorkspaceSplitIntent) => {
      if (!isController) return;
      if (!activeTerminal) {
        if (!activeGroup) return;
        const created = await onCreatePane({
          machineId: commandMachineId,
          cwd: activeGroup.cwd || terminal.cwd,
          workspaceGroupId: activeGroup.workspaceGroupId,
        });
        if (!created) return;
        setMaximizedTerminalId(null);
        setWorkspace((prev) =>
          appendWorkspacePaneToGroup(prev, {
            groupId: activeGroup.id,
            newTerminalId: created.id,
          }),
        );
        onPick(created.id);
        requestPaneFit(created.id);
        return;
      }
      const created = await onSplit(activeTerminal, direction);
      if (!created) return;
      setMaximizedTerminalId(null);
      setWorkspace((prev) =>
        splitWorkspacePane(prev, {
          activeTerminalId: activeTerminal.id,
          newTerminalId: created.id,
          direction,
        }),
      );
      onPick(created.id);
      requestPaneFit(created.id);
    },
    [
      activeGroup,
      activeTerminal,
      commandMachineId,
      isController,
      onCreatePane,
      onPick,
      onSplit,
      requestPaneFit,
      terminal.cwd,
    ],
  );

  const handleFit = useCallback(() => {
    activeCardRef.current?.fitToContainer();
  }, []);

  const handleCreateGroup = useCallback(async () => {
    const name = window.prompt("New tab name", activeGroup?.label ?? "");
    const trimmed = name?.trim();
    if (!trimmed) return;
    const group = await onCreateGroup(commandMachineId, trimmed);
    if (!group) return;
    const nextWorkspaceGroups = [
      ...workspaceGroups.filter((candidate) => candidate.id !== group.id),
      group,
    ];
    setMaximizedTerminalId(null);
    setWorkspace((prev) =>
      selectWorkspaceGroup(
        reconcileTerminalWorkspace(
          prev,
          siblings,
          prev.activeTerminalId,
          nextWorkspaceGroups,
        ),
        group.id,
      ),
    );
  }, [
    activeGroup?.label,
    commandMachineId,
    onCreateGroup,
    siblings,
    workspaceGroups,
  ]);

  const handleReorderGroups = useCallback(
    async (sourceGroupId: string, targetGroupId: string) => {
      if (sourceGroupId === targetGroupId) return;
      const nextIds = reorderedPersistentGroupIds(
        workspace.groups,
        sourceGroupId,
        targetGroupId,
      );
      if (!nextIds) return;
      setWorkspace((prev) => ({
        ...prev,
        groups: reorderWorkspaceGroupsForDisplay(
          prev.groups,
          sourceGroupId,
          targetGroupId,
        ),
      }));
      const groups = await onReorderGroups(commandMachineId, nextIds);
      if (!groups) return;
      setWorkspace((prev) =>
        reconcileTerminalWorkspace(prev, siblings, prev.activeTerminalId, groups),
      );
    },
    [commandMachineId, onReorderGroups, siblings, workspace.groups],
  );

  const confirmDeleteGroup = useCallback(async () => {
    const group = deleteGroup;
    if (!group?.workspaceGroupId) return;
    setDeleteGroup(null);
    await onDeleteGroup(commandMachineId, group.workspaceGroupId);
    const nextWorkspaceGroups = workspaceGroups.filter(
      (candidate) => candidate.id !== group.workspaceGroupId,
    );
    const nextSiblings = siblings.map((sibling) =>
      sibling.workspace_group_id === group.workspaceGroupId
        ? { ...sibling, workspace_group_id: null }
        : sibling,
    );
    setWorkspace((prev) =>
      reconcileTerminalWorkspace(
        prev,
        nextSiblings,
        prev.activeTerminalId,
        nextWorkspaceGroups,
      ),
    );
  }, [commandMachineId, deleteGroup, onDeleteGroup, siblings, workspaceGroups]);

  const handleAssignGroup = useCallback(
    async (workspaceGroupId: string | null) => {
      if (!activeTerminal) return;
      await onAssignGroup(activeTerminal, workspaceGroupId);
    },
    [activeTerminal, onAssignGroup],
  );

  const handleDestroy = useCallback(
    (target: TerminalInfo) => {
      if (!isController) return;
      const nextWorkspace = closeWorkspacePane(workspace, target.id);
      if (
        workspace.activeTerminalId === target.id &&
        nextWorkspace.activeTerminalId &&
        nextWorkspace.activeTerminalId !== target.id
      ) {
        onPick(nextWorkspace.activeTerminalId);
      }
      if (maximizedTerminalId === target.id) setMaximizedTerminalId(null);
      onDestroy(target);
    },
    [isController, maximizedTerminalId, onDestroy, onPick, workspace],
  );

  if (isMobile) {
    return (
      <div
        data-testid="expanded-terminal"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: terminalTheme.background,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <WorkspaceTopBar
          groups={workspace.groups}
          activeGroupId={workspace.activeGroupId}
          activeTerminal={activeTerminal}
          machineId={commandMachineId}
          isController={isController}
          isMobile
          onGroupSelect={activateGroup}
          onCreateGroup={handleCreateGroup}
          onReorderGroups={handleReorderGroups}
          onDeleteGroup={setDeleteGroup}
          onAssignGroup={handleAssignGroup}
          onOpenDrawer={() => setMobileDrawerOpen(true)}
          onSplitRight={() => void handleSplit("right")}
          onSplitDown={() => void handleSplit("down")}
          onFit={handleFit}
          onToggleMaximize={() => {}}
          maximized={false}
          onDestroyActive={() => {
            if (activeTerminal) handleDestroy(activeTerminal);
          }}
          onClose={onClose}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
        <MobileGroupTabs
          groups={workspace.groups}
          activeGroupId={workspace.activeGroupId}
          isController={isController}
          onGroupSelect={activateGroup}
          onCreateGroup={handleCreateGroup}
          onDeleteGroup={setDeleteGroup}
        />
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {activeTerminal ? (
            <WorkspacePaneLeaf
              terminal={activeTerminal}
              isActive
              isController={isController}
              deviceId={deviceId}
              isMobile
              fitRequestNonce={
                fitRequest?.terminalId === activeTerminal.id
                  ? fitRequest.nonce
                  : null
              }
              onActiveRef={(ref) => {
                activeCardRef.current = ref;
              }}
              onFitRequestHandled={handleFitRequestHandled}
              onFocus={activateTerminal}
              onDestroy={handleDestroy}
              onRequestControl={onRequestControl}
              onReleaseControl={onReleaseControl}
            />
          ) : (
            <EmptyWorkspaceGroup
              group={activeGroup}
              isController={isController}
              onNewPane={() => void handleSplit("right")}
            />
          )}
        </div>
        <MobilePaneTabs
          group={activeGroup}
          terminalsById={terminalsById}
          activeTerminalId={activeTerminal?.id ?? null}
          isController={isController}
          onPick={activateTerminal}
          onNew={() => void handleSplit("right")}
        />
        {mobileDrawerOpen && (
          <MobilePaneDrawer
            groups={workspace.groups}
            activeGroupId={workspace.activeGroupId}
            activeTerminalId={activeTerminal?.id ?? null}
            terminalsById={terminalsById}
            isController={isController}
            onClose={() => setMobileDrawerOpen(false)}
            onGroupPick={(id) => {
              activateGroup(id);
              setMobileDrawerOpen(false);
            }}
            onPick={(id) => {
              activateTerminal(id);
              setMobileDrawerOpen(false);
            }}
            onDestroy={handleDestroy}
            onNew={() => void handleSplit("right")}
            onDeleteGroup={setDeleteGroup}
          />
        )}
        <ConfirmDialog
          open={Boolean(deleteGroup)}
          title="Delete group"
          message={`Delete "${deleteGroup?.label ?? "this group"}"? Terminals stay open and move back to cwd grouping.`}
          confirmLabel="Delete group"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => void confirmDeleteGroup()}
          onCancel={() => setDeleteGroup(null)}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="expanded-terminal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: terminalTheme.background,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "webmuxFadeIn 140ms ease-out",
      }}
    >
      <WorkspaceTopBar
        groups={workspace.groups}
        activeGroupId={workspace.activeGroupId}
        activeTerminal={activeTerminal}
        machineId={commandMachineId}
        isController={isController}
        isMobile={false}
        onGroupSelect={activateGroup}
        onCreateGroup={handleCreateGroup}
        onReorderGroups={handleReorderGroups}
        onDeleteGroup={setDeleteGroup}
        onAssignGroup={handleAssignGroup}
        onOpenDrawer={() => {}}
        onSplitRight={() => void handleSplit("right")}
        onSplitDown={() => void handleSplit("down")}
        onFit={handleFit}
        onToggleMaximize={() => {
          if (!activeTerminal) return;
          setMaximizedTerminalId((value) =>
            value === activeTerminal.id ? null : activeTerminal.id,
          );
        }}
        maximized={Boolean(maximizedTerminalId)}
        onDestroyActive={() => {
          if (activeTerminal) handleDestroy(activeTerminal);
        }}
        onClose={onClose}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 8,
          background: terminalTheme.background,
        }}
      >
        {maximizedTerminalId ? (
          <WorkspacePaneLeaf
            terminal={
              terminalsById.get(maximizedTerminalId) ??
              activeTerminal ??
              terminal
            }
            isActive
            isController={isController}
            deviceId={deviceId}
            isMobile={false}
            fitRequestNonce={
              fitRequest?.terminalId === maximizedTerminalId
                ? fitRequest.nonce
                : null
            }
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFitRequestHandled={handleFitRequestHandled}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        ) : activeGroup?.root ? (
          <WorkspacePaneTree
            node={activeGroup.root}
            terminalsById={terminalsById}
            activeTerminalId={activeTerminal?.id ?? null}
            isController={isController}
            deviceId={deviceId}
            fitRequest={fitRequest}
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFitRequestHandled={handleFitRequestHandled}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        ) : (
          <EmptyWorkspaceGroup
            group={activeGroup}
            isController={isController}
            onNewPane={() => void handleSplit("right")}
          />
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleteGroup)}
        title="Delete group"
        message={`Delete "${deleteGroup?.label ?? "this group"}"? Terminals stay open and move back to cwd grouping.`}
        confirmLabel="Delete group"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void confirmDeleteGroup()}
        onCancel={() => setDeleteGroup(null)}
      />
    </div>
  );
}

export const TerminalWorkspace = memo(TerminalWorkspaceComponent);

function WorkspaceTopBar({
  groups,
  activeGroupId,
  activeTerminal,
  machineId,
  isController,
  isMobile,
  maximized,
  onGroupSelect,
  onCreateGroup,
  onReorderGroups,
  onDeleteGroup,
  onAssignGroup,
  onOpenDrawer,
  onSplitRight,
  onSplitDown,
  onFit,
  onToggleMaximize,
  onDestroyActive,
  onClose,
  onRequestControl,
  onReleaseControl,
}: {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  activeTerminal: TerminalInfo | null;
  machineId: string;
  isController: boolean;
  isMobile: boolean;
  maximized: boolean;
  onGroupSelect: (id: string) => void;
  onCreateGroup: () => void;
  onReorderGroups: (sourceGroupId: string, targetGroupId: string) => void;
  onDeleteGroup: (group: WorkspaceGroup) => void;
  onAssignGroup: (workspaceGroupId: string | null) => void;
  onOpenDrawer: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onFit: () => void;
  onToggleMaximize: () => void;
  onDestroyActive: () => void;
  onClose: () => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  const activeGroup =
    groups.find((group) => group.id === activeGroupId) ?? null;
  const activeTitle =
    activeTerminal?.title || activeTerminal?.id.slice(0, 8) || "No panes";
  const activeCwd = activeTerminal?.cwd ?? activeGroup?.cwd ?? "";

  return (
    <div
      style={{
        height: isMobile ? 44 : 42,
        borderBottom: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: isMobile ? "0 8px" : "0 10px",
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {isMobile ? (
        <button
          type="button"
          onClick={onOpenDrawer}
          style={mobileTitleButton}
          data-testid="workspace-mobile-groups"
          title="Panes"
          aria-label="Panes"
        >
          <span style={truncateStyle}>{activeTitle}</span>
          <ChevronDown size={14} />
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 4,
            overflowX: "auto",
            maxWidth: "42vw",
            minWidth: 0,
          }}
        >
          {groups.map((group) => {
            const active = group.id === activeGroupId;
            return (
            <div
              key={group.id}
              draggable={group.persistent}
              onDragStart={(event) => {
                if (!group.persistent) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", group.id);
              }}
              onDragOver={(event) => {
                if (group.persistent) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceGroupId = event.dataTransfer.getData("text/plain");
                if (sourceGroupId) onReorderGroups(sourceGroupId, group.id);
              }}
              style={{
                ...groupTabShellStyle,
                background: active ? colors.bg2 : "transparent",
                borderColor:
                  active ? colorAlpha.accentLine : colors.lineSoft,
              }}
            >
              {group.persistent && (
                <GripVertical
                  size={13}
                  style={{ color: colors.fg3, flexShrink: 0 }}
                />
              )}
              <button
                type="button"
                onClick={() => onGroupSelect(group.id)}
                data-testid={`workspace-group-${group.id}`}
                style={{
                  ...groupTabSelectStyle,
                  color: active ? colors.fg0 : colors.fg2,
                }}
              >
                <span style={truncateStyle}>{group.label}</span>
                <span style={{ color: colors.fg3 }}>{group.paneCount}</span>
              </button>
              {group.persistent && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteGroup(group);
                  }}
                  data-testid={`workspace-group-delete-${group.id}`}
                  title="Delete group"
                  aria-label={`Delete group ${group.label}`}
                  style={groupDeleteButtonStyle}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );})}
          <button
            type="button"
            onClick={onCreateGroup}
            title="New tab"
            aria-label="New tab"
            style={groupAddButtonStyle}
          >
            <Plus size={13} />
          </button>
        </div>
      )}

      {!isMobile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            flex: 1,
            color: colors.fg2,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <span style={{ color: colors.fg1, ...truncateStyle }}>
            {activeTitle}
          </span>
          {activeCwd && (
            <span style={truncateStyle}>{shortenHome(activeCwd)}</span>
          )}
        </div>
      )}

      {!isMobile && (
        <select
          value={activeTerminal?.workspace_group_id ?? ""}
          onChange={(event) => onAssignGroup(event.target.value || null)}
          disabled={!activeTerminal || !isController}
          title="Move pane to tab"
          aria-label="Move pane to tab"
          style={groupSelectStyle}
        >
          <option value="">cwd</option>
          {groups
            .filter((group) => group.persistent && group.workspaceGroupId)
            .map((group) => (
              <option key={group.id} value={group.workspaceGroupId ?? ""}>
                {group.label}
              </option>
            ))}
        </select>
      )}

      {isController ? (
        <button
          type="button"
          data-testid="terminal-mode-toggle"
          onClick={() => onReleaseControl?.(activeTerminal?.machine_id ?? machineId)}
          style={controlPillStyle}
          title="Release control"
        >
          ctrl
        </button>
      ) : (
        <button
          type="button"
          data-testid="terminal-mode-toggle"
          onClick={() => onRequestControl?.(activeTerminal?.machine_id ?? machineId)}
          style={{
            ...controlPillStyle,
            background: colors.accent,
            color: "#120904",
          }}
          title="Take control"
        >
          control
        </button>
      )}

      {!isMobile && (
        <>
          <IconButton
            disabled={!isController}
            title="Split right"
            onClick={onSplitRight}
          >
            <Columns2 size={14} />
          </IconButton>
          <IconButton
            disabled={!isController}
            title="Split down"
            onClick={onSplitDown}
          >
            <PanelBottom size={14} />
          </IconButton>
          <IconButton
            disabled={!activeTerminal}
            title="Fit"
            testId="terminal-fit-button"
            onClick={onFit}
          >
            <Expand size={14} />
          </IconButton>
          <IconButton
            disabled={!activeTerminal}
            title={maximized ? "Restore panes" : "Maximize pane"}
            onClick={onToggleMaximize}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
        </>
      )}
      {isMobile && (
        <>
          {isController && activeTerminal && (
            <IconButton
              title="Fit"
              testId="terminal-fit-button"
              onClick={onFit}
            >
              <Expand size={15} />
            </IconButton>
          )}
          <IconButton
            disabled={!isController}
            title="New pane"
            onClick={onSplitRight}
          >
            <Plus size={15} />
          </IconButton>
          <IconButton
            disabled={!isController || !activeTerminal}
            title="Close terminal"
            testId="workspace-close-active-terminal"
            onClick={onDestroyActive}
          >
            <Trash2 size={15} />
          </IconButton>
        </>
      )}
      <IconButton
        title="Exit workspace"
        testId="expanded-close"
        onClick={onClose}
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}

function MobileGroupTabs({
  groups,
  activeGroupId,
  isController,
  onGroupSelect,
  onCreateGroup,
  onDeleteGroup,
}: {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  isController: boolean;
  onGroupSelect: (id: string) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (group: WorkspaceGroup) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div
      data-testid="workspace-mobile-group-tabs"
      style={{
        minHeight: 42,
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "6px 8px",
        borderBottom: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {groups.map((group) => {
        const active = group.id === activeGroupId;
        return (
          <div
            key={group.id}
            style={{
              ...mobileGroupTabShellStyle,
              borderRadius: 7,
              border: `1px solid ${
                active ? colorAlpha.accentLine : colors.lineSoft
              }`,
              background: active ? colors.bg2 : "transparent",
            }}
          >
            <button
              type="button"
              data-testid={`workspace-mobile-group-tab-${group.id}`}
              onClick={() => onGroupSelect(group.id)}
              style={{
                ...mobileGroupTabSelectStyle,
                color: active ? colors.fg0 : colors.fg2,
              }}
              title={group.label}
              aria-label={`Switch to group ${group.label}`}
            >
              <span style={truncateStyle}>{group.label}</span>
              <span style={{ color: active ? colors.accent : colors.fg3 }}>
                {group.paneCount}
              </span>
            </button>
            {group.persistent && (
              <button
                type="button"
                data-testid={`workspace-mobile-group-delete-${group.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteGroup(group);
                }}
                style={{
                  ...smallIconButtonStyle,
                  width: 20,
                  height: 20,
                  color: active ? colors.fg2 : colors.fg3,
                  flexShrink: 0,
                }}
                title="Delete group"
                aria-label={`Delete group ${group.label}`}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        disabled={!isController}
        onClick={onCreateGroup}
        title="New tab"
        aria-label="New tab"
        style={{
          ...mobilePaneTabStyle,
          minWidth: 36,
          width: 36,
          padding: 0,
          opacity: isController ? 1 : 0.45,
          cursor: isController ? "pointer" : "not-allowed",
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function WorkspacePaneTree({
  node,
  terminalsById,
  activeTerminalId,
  isController,
  deviceId,
  fitRequest,
  onActiveRef,
  onFitRequestHandled,
  onFocus,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}: {
  node: WorkspacePaneNode;
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string | null;
  isController: boolean;
  deviceId: string;
  fitRequest: { terminalId: string; nonce: number } | null;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  if (node.type === "leaf") {
    const terminal = terminalsById.get(node.terminalId);
    if (!terminal) return null;
    return (
      <WorkspacePaneLeaf
        terminal={terminal}
        isActive={terminal.id === activeTerminalId}
        isController={isController}
        deviceId={deviceId}
        isMobile={false}
        fitRequestNonce={
          fitRequest?.terminalId === terminal.id ? fitRequest.nonce : null
        }
        onActiveRef={onActiveRef}
        onFitRequestHandled={onFitRequestHandled}
        onFocus={onFocus}
        onDestroy={onDestroy}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
      />
    );
  }
  const row = node.direction === "horizontal";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: row ? "row" : "column",
        width: "100%",
        height: "100%",
        gap: 6,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div style={{ flex: node.ratio, minWidth: 0, minHeight: 0 }}>
        <WorkspacePaneTree
          node={node.first}
          terminalsById={terminalsById}
          activeTerminalId={activeTerminalId}
          isController={isController}
          deviceId={deviceId}
          fitRequest={fitRequest}
          onActiveRef={onActiveRef}
          onFitRequestHandled={onFitRequestHandled}
          onFocus={onFocus}
          onDestroy={onDestroy}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
      </div>
      <div style={{ flex: 1 - node.ratio, minWidth: 0, minHeight: 0 }}>
        <WorkspacePaneTree
          node={node.second}
          terminalsById={terminalsById}
          activeTerminalId={activeTerminalId}
          isController={isController}
          deviceId={deviceId}
          fitRequest={fitRequest}
          onActiveRef={onActiveRef}
          onFitRequestHandled={onFitRequestHandled}
          onFocus={onFocus}
          onDestroy={onDestroy}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
      </div>
    </div>
  );
}

function WorkspacePaneLeaf({
  terminal,
  isActive,
  isController,
  deviceId,
  isMobile,
  fitRequestNonce,
  onActiveRef,
  onFitRequestHandled,
  onFocus,
  onDestroy,
  onRequestControl,
  onReleaseControl,
}: {
  terminal: TerminalInfo;
  isActive: boolean;
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  fitRequestNonce: number | null;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  const cardRef = useRef<TerminalCardRef>(null);

  useEffect(() => {
    if (!isActive) return;
    const frame = requestAnimationFrame(() => {
      if (isMobile && isController) {
        cardRef.current?.fitToContainer({ skipIfUnchanged: true });
      } else {
        cardRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive, isController, isMobile, terminal.id]);

  useEffect(() => {
    if (!isActive || !isController || fitRequestNonce === null) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const card = cardRef.current;
        if (!card) return;
        card.fitToContainer({ skipIfUnchanged: true });
        onFitRequestHandled(fitRequestNonce);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [fitRequestNonce, isActive, isController, onFitRequestHandled]);

  useEffect(() => {
    if (!isActive) return;
    onActiveRef(cardRef.current);
    return () => onActiveRef(null);
  }, [isActive, onActiveRef]);

  return (
    <div
      data-testid={`workspace-pane-${terminal.id}`}
      onMouseDown={() => onFocus(terminal.id)}
      onMouseMove={(event) => {
        if (isMobile || isActive) return;
        const target = event.target;
        if (target instanceof Element && target.closest("button")) return;
        onFocus(terminal.id);
      }}
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        border: `1px solid ${isActive ? colors.accent : colors.lineSoft}`,
        boxShadow: isActive ? `0 0 0 1px ${colorAlpha.accentLine}` : "none",
        overflow: "hidden",
      }}
    >
      {!isMobile && (
        <div
          data-testid={`expanded-thumb-${terminal.id}`}
          style={{
            height: 28,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "0 8px",
            background: isActive ? colors.bg2 : colors.bg1,
            borderBottom: `1px solid ${colors.lineSoft}`,
            color: colors.fg2,
            fontSize: 11,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: terminal.reachable ? colors.ok : colors.warn,
              flexShrink: 0,
            }}
          />
          <span
            style={{ color: colors.fg1, fontWeight: 600, ...truncateStyle }}
          >
            {terminal.title || terminal.id.slice(0, 8)}
          </span>
          <span
            style={{
              color: colors.fg3,
              fontFamily: "var(--font-mono)",
              ...truncateStyle,
            }}
          >
            {shortenHome(terminal.cwd)}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            data-testid={`expanded-thumb-close-${terminal.id}`}
            disabled={!isController}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDestroy(terminal);
            }}
            title={isController ? "Close pane" : "View only"}
            style={{
              ...smallIconButtonStyle,
              color: isController ? colors.fg2 : colors.fg3,
              cursor: isController ? "pointer" : "not-allowed",
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <TerminalCard
        ref={cardRef}
        terminal={terminal}
        displayMode="tab"
        isMobile={isMobile}
        isController={isController}
        deviceId={deviceId}
        onSelectTab={() => {}}
        onDestroy={onDestroy}
        onRequestControl={onRequestControl}
        onReleaseControl={onReleaseControl}
      />
    </div>
  );
}

function EmptyWorkspaceGroup({
  group,
  isController,
  onNewPane,
}: {
  group: WorkspaceGroup | null;
  isController: boolean;
  onNewPane: () => void;
}) {
  return (
    <div
      data-testid="workspace-empty-group"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bg0,
        border: `1px solid ${colors.lineSoft}`,
      }}
    >
      <button
        type="button"
        disabled={!isController || !group}
        onClick={onNewPane}
        style={{
          ...drawerNewButtonStyle,
          opacity: isController && group ? 1 : 0.5,
          cursor: isController && group ? "pointer" : "not-allowed",
        }}
      >
        <Plus size={14} />
        New pane
      </button>
    </div>
  );
}

function MobilePaneTabs({
  group,
  terminalsById,
  activeTerminalId,
  isController,
  onPick,
  onNew,
}: {
  group: WorkspaceGroup | null;
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string | null;
  isController: boolean;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const ids = group ? collectIds(group.root) : [];
  return (
    <div
      style={{
        minHeight: 48,
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "7px 8px",
        borderTop: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {ids.map((id) => {
        const terminal = terminalsById.get(id);
        if (!terminal) return null;
        const active = id === activeTerminalId;
        return (
          <button
            key={id}
            type="button"
            data-testid={`expanded-thumb-${id}`}
            onClick={() => onPick(id)}
            style={{
              ...mobilePaneTabStyle,
              color: active ? colors.fg0 : colors.fg2,
              background: active ? colors.bg2 : "transparent",
              borderColor: active ? colors.accent : colors.lineSoft,
            }}
          >
            {terminal.id.slice(0, 4)}
          </button>
        );
      })}
      <button
        type="button"
        disabled={!isController}
        onClick={onNew}
        style={mobilePaneTabStyle}
        title="New pane"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function MobilePaneDrawer({
  groups,
  activeGroupId,
  activeTerminalId,
  terminalsById,
  isController,
  onClose,
  onGroupPick,
  onPick,
  onDestroy,
  onNew,
  onDeleteGroup,
}: {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  activeTerminalId: string | null;
  terminalsById: Map<string, TerminalInfo>;
  isController: boolean;
  onClose: () => void;
  onGroupPick: (groupId: string) => void;
  onPick: (terminalId: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onNew: () => void;
  onDeleteGroup: (group: WorkspaceGroup) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,0.52)",
        display: "flex",
        alignItems: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxHeight: "78dvh",
          background: colors.bg1,
          borderTop: `1px solid ${colors.line}`,
          padding: "10px 10px 14px",
          overflow: "auto",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 10 }}
        >
          <strong style={{ color: colors.fg0, fontSize: 14 }}>Panes</strong>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={drawerDoneButtonStyle}>
            Done
          </button>
        </div>
        {groups.map((group) => (
          <div key={group.id} style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => onGroupPick(group.id)}
              style={{
                ...drawerGroupButtonStyle,
                color: group.id === activeGroupId ? colors.fg0 : colors.fg2,
              }}
            >
              {group.label}
              <span style={{ color: colors.fg3 }}>{group.paneCount}</span>
            </button>
            {group.persistent && (
              <button
                type="button"
                disabled={!isController}
                onClick={() => onDeleteGroup(group)}
                data-testid={`workspace-drawer-group-delete-${group.id}`}
                style={{
                  ...drawerNewButtonStyle,
                  height: 30,
                  marginBottom: 6,
                  justifyContent: "flex-start",
                  color: isController ? colors.danger : colors.fg3,
                  opacity: isController ? 1 : 0.45,
                }}
              >
                <Trash2 size={13} />
                Delete group
              </button>
            )}
            {collectIds(group.root).map((id) => {
              const terminal = terminalsById.get(id);
              if (!terminal) return null;
              return (
                <div key={id} style={drawerPaneRowStyle}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      color:
                        id === activeTerminalId ? colors.accent : colors.fg1,
                      padding: 0,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {terminal.title || terminal.id.slice(0, 8)}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: colors.fg3,
                        ...truncateStyle,
                      }}
                    >
                      {shortenHome(terminal.cwd)}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={!isController}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDestroy(terminal);
                    }}
                    style={smallIconButtonStyle}
                    title="Close pane"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        <button
          type="button"
          disabled={!isController}
          onClick={onNew}
          style={drawerNewButtonStyle}
        >
          <Plus size={14} />
          New pane
        </button>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  disabled = false,
  testId,
  onClick,
}: {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...iconButtonStyle,
        color: disabled ? colors.fg3 : colors.fg2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

const iconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};

const smallIconButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  border: "none",
  background: "transparent",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  color: colors.fg2,
};

const groupTabShellStyle: CSSProperties = {
  height: 28,
  maxWidth: 150,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  padding: "0 4px 0 6px",
  fontSize: 12,
  flexShrink: 0,
  cursor: "grab",
};

const groupTabSelectStyle: CSSProperties = {
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: "none",
  background: "transparent",
  padding: "0 2px",
  fontSize: 12,
  cursor: "pointer",
};

const groupDeleteButtonStyle: CSSProperties = {
  ...smallIconButtonStyle,
  width: 20,
  height: 20,
  color: colors.fg3,
  cursor: "pointer",
  flexShrink: 0,
};

const groupAddButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
  cursor: "pointer",
};

const groupSelectStyle: CSSProperties = {
  height: 28,
  maxWidth: 150,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg1,
  fontSize: 12,
  padding: "0 6px",
  flexShrink: 0,
};

const controlPillStyle: CSSProperties = {
  height: 24,
  borderRadius: 5,
  border: `1px solid ${colorAlpha.accentLine}`,
  background: colorAlpha.accentSoft,
  color: colors.accent,
  padding: "0 8px",
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  flexShrink: 0,
  cursor: "pointer",
};

const mobileTitleButton: CSSProperties = {
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg0,
  padding: "0 9px",
  fontSize: 12,
  fontWeight: 700,
  minWidth: 0,
  flex: 1,
  cursor: "pointer",
};

const mobilePaneTabStyle: CSSProperties = {
  height: 32,
  minWidth: 44,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: "transparent",
  color: colors.fg2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};

const mobileGroupTabShellStyle: CSSProperties = {
  height: 30,
  maxWidth: 170,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "0 4px",
  flexShrink: 0,
};

const mobileGroupTabSelectStyle: CSSProperties = {
  minWidth: 0,
  height: "100%",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: "none",
  background: "transparent",
  padding: "0 5px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const drawerDoneButtonStyle: CSSProperties = {
  height: 30,
  borderRadius: 6,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg1,
  padding: "0 10px",
  fontSize: 12,
};

const drawerGroupButtonStyle: CSSProperties = {
  width: "100%",
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 12,
  fontWeight: 700,
};

const drawerPaneRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 48,
  borderTop: `1px solid ${colors.lineSoft}`,
  padding: "7px 0",
};

const drawerNewButtonStyle: CSSProperties = {
  width: "100%",
  height: 38,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  borderRadius: 7,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.bg2,
  color: colors.fg1,
  fontSize: 13,
  fontWeight: 700,
};

const truncateStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

function collectIds(root: WorkspacePaneNode | null): string[] {
  if (!root) return [];
  if (root.type === "leaf") return [root.terminalId];
  return [...collectIds(root.first), ...collectIds(root.second)];
}

function reorderedPersistentGroupIds(
  groups: WorkspaceGroup[],
  sourceGroupId: string,
  targetGroupId: string,
): string[] | null {
  const persistentIds = groups
    .filter((group) => group.persistent && group.workspaceGroupId)
    .map((group) => group.workspaceGroupId as string);
  if (
    !persistentIds.includes(sourceGroupId) ||
    !persistentIds.includes(targetGroupId)
  ) {
    return null;
  }
  return moveBefore(persistentIds, sourceGroupId, targetGroupId);
}

function reorderWorkspaceGroupsForDisplay(
  groups: WorkspaceGroup[],
  sourceGroupId: string,
  targetGroupId: string,
): WorkspaceGroup[] {
  const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId);
  const targetIndex = groups.findIndex((group) => group.id === targetGroupId);
  if (sourceIndex === -1 || targetIndex === -1) return groups;
  const next = groups.slice();
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex > sourceIndex ? targetIndex - 1 : targetIndex, 0, source);
  return next;
}

function moveBefore(
  ids: string[],
  sourceGroupId: string,
  targetGroupId: string,
): string[] {
  const next = ids.slice();
  const sourceIndex = next.indexOf(sourceGroupId);
  const targetIndex = next.indexOf(targetGroupId);
  if (sourceIndex === -1 || targetIndex === -1) return ids;
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex > sourceIndex ? targetIndex - 1 : targetIndex, 0, source);
  return next;
}

function containsTerminal(root: WorkspacePaneNode | null, terminalId: string) {
  return collectIds(root).includes(terminalId);
}

function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}

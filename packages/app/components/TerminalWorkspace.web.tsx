import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  ReactNode,
} from "react";
import type {
  TerminalInfo,
  WorkspaceColumnWidth,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
  WorkspaceLayoutMode,
  WorkspaceLayoutNode,
  WorkspaceScrollableLayout,
} from "@webmux/shared";
import {
  ChevronDown,
  Expand,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { TerminalCard, type TerminalCardRef } from "./TerminalCard.web";
import { colors, colorAlpha, terminalTheme } from "@/lib/colors";
import {
  type WorkspaceGroup,
  type WorkspacePaneFocusDirection,
  type WorkspacePaneNode,
  type WorkspaceSplitIntent,
  type TerminalWorkspace as TerminalWorkspaceState,
  appendWorkspacePaneToGroup,
  closeWorkspacePane,
  createTerminalWorkspace,
  findAdjacentScrollableColumn,
  findAdjacentWorkspacePane,
  getActiveWorkspaceGroup,
  reconcileTerminalWorkspace,
  selectWorkspaceGroup,
  setWorkspaceColumnWidth,
  splitWorkspacePane,
  swapWorkspacePanes,
} from "@/lib/terminalWorkspaceLayout";
import { ScrollableWorkspace } from "./ScrollableWorkspace";
import { formatPrefixBinding, type PrefixActionId } from "@/lib/prefixKey";
import { usePrefixKey } from "@/lib/prefixKeyContext";

interface TerminalWorkspaceProps {
  terminal: TerminalInfo;
  siblings: TerminalInfo[];
  workspaceGroups: WorkspaceGroupInfo[];
  workspaceLayouts: WorkspaceLayoutInfo[];
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onDestroy: (
    terminal: TerminalInfo,
    options?: WorkspaceDestroyOptions,
  ) => Promise<"accepted" | "pending">;
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
  onSaveWorkspaceLayout: (
    machineId: string,
    groupKey: string,
    root: WorkspaceLayoutNode | null,
    mode: WorkspaceLayoutMode | null,
    scrollable: WorkspaceScrollableLayout | null,
  ) => Promise<WorkspaceLayoutInfo | null | void>;
  onAssignGroup: (
    terminal: TerminalInfo,
    workspaceGroupId: string | null,
  ) => Promise<void>;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
  // Command channel for the desktop TabBar / command palette (Phase 2). The
  // workspace fills it with live handlers; the chrome above calls them.
  commandsRef?: MutableRefObject<WorkspaceCommandChannel>;
  onActiveGroupChange?: (groupId: string | null) => void;
}

// Handlers the desktop chrome (TabBar, CommandPalette) invokes on the
// workspace. Optional fields stay unset until the workspace mounts.
export interface WorkspaceCommandChannel {
  selectGroup?: (groupId: string) => void;
  reorderGroups?: (
    sourceGroupId: string,
    targetGroupId: string,
    placement: GroupDropPlacement,
  ) => void;
  runPrefixAction?: (action: PrefixActionId) => void;
}

export type GroupDropPlacement = "before" | "after";

// Prefix actions owned by this component (TerminalCanvas owns the rest).
const WORKSPACE_PREFIX_ACTIONS: PrefixActionId[] = [
  "splitRight",
  "splitDown",
  "paneLeft",
  "paneRight",
  "paneUp",
  "paneDown",
  "zoomPane",
  "closePane",
  "nextTab",
  "prevTab",
  "selectTab1",
  "selectTab2",
  "selectTab3",
  "selectTab4",
  "selectTab5",
  "selectTab6",
  "selectTab7",
  "selectTab8",
  "selectTab9",
];

export interface WorkspaceFitRequest {
  terminalIds: string[];
  focusTerminalId: string | null;
  nonce: number;
}

interface WorkspaceDestroyOptions {
  keepWorkspaceOpen?: boolean;
  afterAccepted?: () => void;
}

function TerminalWorkspaceComponent({
  terminal,
  siblings,
  workspaceGroups,
  workspaceLayouts,
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
  onSaveWorkspaceLayout,
  onAssignGroup,
  onRequestControl,
  onReleaseControl,
  commandsRef,
  onActiveGroupChange,
}: TerminalWorkspaceProps) {
  const [workspace, setWorkspace] = useState(() =>
    createTerminalWorkspace(
      siblings,
      terminal.id,
      workspaceGroups,
      workspaceLayouts,
    ),
  );
  const workspaceRef = useRef(workspace);
  const commitWorkspace = useCallback((next: TerminalWorkspaceState) => {
    workspaceRef.current = next;
    setWorkspace(next);
    return next;
  }, []);
  const updateWorkspace = useCallback(
    (producer: (current: TerminalWorkspaceState) => TerminalWorkspaceState) =>
      commitWorkspace(producer(workspaceRef.current)),
    [commitWorkspace],
  );
  const activeCardRef = useRef<TerminalCardRef | null>(null);
  const fitRequestCounterRef = useRef(0);
  const [fitRequest, setFitRequest] = useState<WorkspaceFitRequest | null>(
    null,
  );
  const [maximizedTerminalId, setMaximizedTerminalId] = useState<string | null>(
    null,
  );
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [deleteGroup, setDeleteGroup] = useState<WorkspaceGroup | null>(null);
  const [paneMenu, setPaneMenu] = useState<{
    terminalId: string;
    x: number;
    y: number;
  } | null>(null);
  const terminalsById = useMemo(() => {
    const map = new Map<string, TerminalInfo>();
    for (const sibling of siblings) map.set(sibling.id, sibling);
    return map;
  }, [siblings]);

  const previousTerminalIdRef = useRef(terminal.id);
  useEffect(() => {
    const externalTerminalChanged = previousTerminalIdRef.current !== terminal.id;
    previousTerminalIdRef.current = terminal.id;
    setWorkspace((prev) => {
      const next = reconcileTerminalWorkspace(
        prev,
        siblings,
        externalTerminalChanged ? terminal.id : prev.activeTerminalId,
        workspaceGroups,
        workspaceLayouts,
      );
      workspaceRef.current = next;
      return next;
    });
  }, [siblings, terminal.id, workspaceGroups, workspaceLayouts]);

  const activeGroup = getActiveWorkspaceGroup(workspace);
  const activeTerminal = workspace.activeTerminalId
    ? terminalsById.get(workspace.activeTerminalId) ?? null
    : null;
  const commandMachineId = activeTerminal?.machine_id ?? terminal.machine_id;
  const layoutSaveQueuesRef = useRef(new Map<string, Promise<void>>());

  const persistGroupLayout = useCallback(
    async (nextWorkspace: TerminalWorkspaceState, groupId: string | null) => {
      if (!groupId) return;
      const group = nextWorkspace.groups.find(
        (candidate) => candidate.id === groupId,
      );
      if (!group) return;
      const queueKey = `${commandMachineId}\u0000${group.id}`;
      const previous =
        layoutSaveQueuesRef.current.get(queueKey) ?? Promise.resolve();
      const save = previous
        .catch(() => undefined)
        .then(async () => {
          try {
            await onSaveWorkspaceLayout(commandMachineId, group.id, group.root, null, null);
          } catch (error) {
            console.error("Failed to save workspace pane layout", error);
          }
        });
      layoutSaveQueuesRef.current.set(queueKey, save);
      void save.finally(() => {
        if (layoutSaveQueuesRef.current.get(queueKey) === save) {
          layoutSaveQueuesRef.current.delete(queueKey);
        }
      });
      await save;
    },
    [commandMachineId, onSaveWorkspaceLayout],
  );

  const requestPaneFit = useCallback(
    (
      terminalIds: string | string[] | null,
      options: { focusTerminalId?: string | null } = {},
    ) => {
      const ids = Array.isArray(terminalIds)
        ? terminalIds
        : terminalIds
          ? [terminalIds]
          : [];
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) return;
      fitRequestCounterRef.current += 1;
      setFitRequest({
        terminalIds: uniqueIds,
        focusTerminalId: options.focusTerminalId ?? uniqueIds[0] ?? null,
        nonce: fitRequestCounterRef.current,
      });
    },
    [],
  );
  const handleFitRequestHandled = useCallback(
    (nonce: number, terminalId: string) => {
      setFitRequest((current) => {
        if (current?.nonce !== nonce) return current;
        const terminalIds = current.terminalIds.filter(
          (id) => id !== terminalId,
        );
        return terminalIds.length === 0
          ? null
          : {
              ...current,
              terminalIds,
            };
      });
    },
    [],
  );

  const activateTerminal = useCallback(
    (terminalId: string) => {
      const changedTerminal = terminalId !== workspaceRef.current.activeTerminalId;
      if (changedTerminal) setMaximizedTerminalId(null);
      updateWorkspace((prev) => {
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
        requestPaneFit(terminalId, { focusTerminalId: terminalId });
      }
    },
    [
      isController,
      isMobile,
      onPick,
      requestPaneFit,
      updateWorkspace,
    ],
  );

  const activateGroup = useCallback(
    (groupId: string) => {
      setMaximizedTerminalId(null);
      const next = updateWorkspace((current) =>
        selectWorkspaceGroup(current, groupId),
      );
      if (next.activeTerminalId) onPick(next.activeTerminalId);
      if (!isMobile && isController) {
        requestPaneFit(collectIds(getActiveWorkspaceGroup(next)?.root ?? null), {
          focusTerminalId: next.activeTerminalId,
        });
      }
    },
    [isController, isMobile, onPick, requestPaneFit, updateWorkspace],
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
        const groupId = activeGroup.id;
        const nextWorkspace = updateWorkspace((current) =>
          appendWorkspacePaneToGroup(current, {
            groupId,
            newTerminalId: created.id,
          }),
        );
        onPick(created.id);
        requestPaneFit(collectIds(getActiveWorkspaceGroup(nextWorkspace)?.root ?? null), {
          focusTerminalId: created.id,
        });
        await persistGroupLayout(nextWorkspace, groupId);
        return;
      }
      const sourceTerminal = activeTerminal;
      const sourceGroupId = activeGroup?.id ?? workspaceRef.current.activeGroupId;
      const created = await onSplit(activeTerminal, direction);
      if (!created) return;
      setMaximizedTerminalId(null);
      let savedGroupId: string | null = null;
      const nextWorkspace = updateWorkspace((current) => {
        let next = splitWorkspacePane(current, {
          activeTerminalId: sourceTerminal.id,
          newTerminalId: created.id,
          direction,
        });
        if (!next.groups.some((group) => containsTerminal(group.root, created.id))) {
          const fallbackGroupId =
            sourceGroupId && next.groups.some((group) => group.id === sourceGroupId)
              ? sourceGroupId
              : next.activeGroupId;
          if (fallbackGroupId) {
            next = appendWorkspacePaneToGroup(next, {
              groupId: fallbackGroupId,
              newTerminalId: created.id,
            });
          }
        }
        savedGroupId =
          next.groups.find((group) => containsTerminal(group.root, created.id))
            ?.id ?? next.activeGroupId;
        return next;
      });
      onPick(created.id);
      requestPaneFit(
        collectIds(getActiveWorkspaceGroup(nextWorkspace)?.root ?? null),
        { focusTerminalId: created.id },
      );
      await persistGroupLayout(nextWorkspace, savedGroupId);
    },
    [
      activeGroup,
      activeTerminal,
      commandMachineId,
      isController,
      onCreatePane,
      onPick,
      onSplit,
      persistGroupLayout,
      requestPaneFit,
      terminal.cwd,
      updateWorkspace,
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
    updateWorkspace((prev) =>
      selectWorkspaceGroup(
        reconcileTerminalWorkspace(
          prev,
          siblings,
          prev.activeTerminalId,
          nextWorkspaceGroups,
          workspaceLayouts,
        ),
        group.id,
      ),
    );
  }, [
    activeGroup?.label,
    commandMachineId,
    onCreateGroup,
    siblings,
    updateWorkspace,
    workspaceGroups,
    workspaceLayouts,
  ]);

  const handleReorderGroups = useCallback(
    async (
      sourceGroupId: string,
      targetGroupId: string,
      placement: GroupDropPlacement,
    ) => {
      if (sourceGroupId === targetGroupId) return;
      const nextIds = reorderedPersistentGroupIds(
        workspaceRef.current.groups,
        sourceGroupId,
        targetGroupId,
        placement,
      );
      if (!nextIds) return;
      updateWorkspace((prev) => ({
        ...prev,
        groups: reorderWorkspaceGroupsForDisplay(
          prev.groups,
          sourceGroupId,
          targetGroupId,
          placement,
        ),
      }));
      const groups = await onReorderGroups(commandMachineId, nextIds);
      if (!groups) return;
      updateWorkspace((prev) =>
        reconcileTerminalWorkspace(
          prev,
          siblings,
          prev.activeTerminalId,
          groups,
          workspaceLayouts,
        ),
      );
    },
    [
      commandMachineId,
      onReorderGroups,
      siblings,
      updateWorkspace,
      workspaceLayouts,
    ],
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
    updateWorkspace((prev) =>
      reconcileTerminalWorkspace(
        prev,
        nextSiblings,
        prev.activeTerminalId,
        nextWorkspaceGroups,
        workspaceLayouts,
      ),
    );
  }, [
    commandMachineId,
    deleteGroup,
    onDeleteGroup,
    siblings,
    updateWorkspace,
    workspaceGroups,
    workspaceLayouts,
  ]);

  const persistColumnsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistColumnsPendingRef = useRef<WorkspaceGroup | null>(null);

  const schedulePersistColumns = useCallback(
    (group: WorkspaceGroup) => {
      persistColumnsPendingRef.current = group;
      if (persistColumnsTimerRef.current) return;
      persistColumnsTimerRef.current = setTimeout(() => {
        persistColumnsTimerRef.current = null;
        const pending = persistColumnsPendingRef.current;
        persistColumnsPendingRef.current = null;
        if (!pending || !commandMachineId) return;
        void onSaveWorkspaceLayout(
          commandMachineId,
          pending.id,
          pending.root,
          pending.layoutMode,
          pending.scrollable,
        );
      }, 200);
    },
    [commandMachineId, onSaveWorkspaceLayout],
  );

  useEffect(
    () => () => {
      if (persistColumnsTimerRef.current) clearTimeout(persistColumnsTimerRef.current);
    },
    [],
  );

  const handleResizeColumn = useCallback(
    (terminalId: string, width: WorkspaceColumnWidth) => {
      setWorkspace((prev) => {
        const next = setWorkspaceColumnWidth(prev, terminalId, width);
        const group = next.groups.find((g) =>
          g.scrollable?.columns.some((c) => c.terminalId === terminalId),
        );
        if (group && commandMachineId) {
          schedulePersistColumns(group);
        }
        return next;
      });
    },
    [commandMachineId, schedulePersistColumns],
  );

  const handleReorderColumns = useCallback(
    (sourceTerminalId: string, targetTerminalId: string) => {
      setWorkspace((prev) => swapWorkspacePanes(prev, sourceTerminalId, targetTerminalId));
    },
    [],
  );

  const focusPaneByDirection = useCallback(
    (direction: WorkspacePaneFocusDirection) => {
      if (maximizedTerminalId) return;
      const root = getActiveWorkspaceGroup(workspace)?.root ?? null;
      const nextTerminalId = findAdjacentWorkspacePane(
        root,
        direction,
        workspace.activeTerminalId,
      );
      if (nextTerminalId) activateTerminal(nextTerminalId);
    },
    [activateTerminal, maximizedTerminalId, workspace],
  );

  const switchGroupByOffset = useCallback(
    (offset: number) => {
      const groups = workspace.groups;
      if (groups.length === 0) return;
      const currentIndex = Math.max(
        0,
        groups.findIndex((group) => group.id === workspace.activeGroupId),
      );
      const nextIndex = (currentIndex + offset + groups.length) % groups.length;
      const nextGroup = groups[nextIndex];
      if (nextGroup && nextGroup.id !== workspace.activeGroupId) {
        activateGroup(nextGroup.id);
      }
    },
    [activateGroup, workspace.activeGroupId, workspace.groups],
  );

  const switchGroupByIndex = useCallback(
    (index: number) => {
      const group = workspace.groups[index];
      if (group && group.id !== workspace.activeGroupId) activateGroup(group.id);
    },
    [activateGroup, workspace.activeGroupId, workspace.groups],
  );

  const handleDestroy = useCallback(
    (target: TerminalInfo) => {
      if (!isController) return;
      const currentWorkspace = workspaceRef.current;
      const targetGroupId =
        currentWorkspace.groups.find((group) =>
          containsTerminal(group.root, target.id),
        )?.id ?? null;
      const previewWorkspace = closeWorkspacePane(currentWorkspace, target.id);
      const applyClosedWorkspace = () => {
        const before = workspaceRef.current;
        const nextWorkspace = updateWorkspace((current) =>
          closeWorkspacePane(current, target.id),
        );
        if (
          before.activeTerminalId === target.id &&
          nextWorkspace.activeTerminalId &&
          nextWorkspace.activeTerminalId !== target.id
        ) {
          onPick(nextWorkspace.activeTerminalId);
        }
        if (maximizedTerminalId === target.id) setMaximizedTerminalId(null);
        void persistGroupLayout(nextWorkspace, targetGroupId);
      };
      void (async () => {
        const result = await onDestroy(target, {
          keepWorkspaceOpen:
            currentWorkspace.activeTerminalId === target.id &&
            !previewWorkspace.activeTerminalId &&
            Boolean(previewWorkspace.activeGroupId),
          afterAccepted: applyClosedWorkspace,
        });
        if (result !== "accepted") return;
        applyClosedWorkspace();
      })().catch((error) => {
        console.error("Failed to close workspace pane", error);
      });
    },
    [
      isController,
      maximizedTerminalId,
      onDestroy,
      onPick,
      persistGroupLayout,
      updateWorkspace,
    ],
  );

  // ---- prefix-key engine wiring (⌃B) ----
  // Workspace-owned prefix actions register into the shared dispatcher (the
  // window keydown listener lives in TerminalCanvas). Handlers sit in a ref
  // so the registration effect stays stable while calling the latest
  // closures.
  const prefixKey = usePrefixKey();
  const workspacePrefixActionsRef = useRef<
    Partial<Record<PrefixActionId, () => void>>
  >({});

  // Pane focus keeps the old scrollable-layout behaviour: left/right walk
  // columns, up/down are no-ops there; tiling mode walks the split tree.
  const focusPrefixPane = useCallback(
    (direction: WorkspacePaneFocusDirection) => {
      if (activeGroup?.layoutMode === "scrollable") {
        if (direction === "up" || direction === "down") return;
        const nextId = activeGroup.scrollable
          ? findAdjacentScrollableColumn(
              activeGroup.scrollable,
              direction,
              workspace.activeTerminalId,
            )
          : null;
        if (nextId) activateTerminal(nextId);
        return;
      }
      focusPaneByDirection(direction);
    },
    [
      activeGroup,
      activateTerminal,
      focusPaneByDirection,
      workspace.activeTerminalId,
    ],
  );

  const toggleMaximizeActivePane = useCallback(() => {
    if (!activeTerminal) return;
    setMaximizedTerminalId((value) =>
      value === activeTerminal.id ? null : activeTerminal.id,
    );
  }, [activeTerminal]);

  workspacePrefixActionsRef.current = {
    splitRight: () => void handleSplit("right"),
    splitDown: () => void handleSplit("down"),
    paneLeft: () => focusPrefixPane("left"),
    paneRight: () => focusPrefixPane("right"),
    paneUp: () => focusPrefixPane("up"),
    paneDown: () => focusPrefixPane("down"),
    zoomPane: toggleMaximizeActivePane,
    closePane: () => {
      if (activeTerminal) handleDestroy(activeTerminal);
    },
    nextTab: () => switchGroupByOffset(1),
    prevTab: () => switchGroupByOffset(-1),
    selectTab1: () => switchGroupByIndex(0),
    selectTab2: () => switchGroupByIndex(1),
    selectTab3: () => switchGroupByIndex(2),
    selectTab4: () => switchGroupByIndex(3),
    selectTab5: () => switchGroupByIndex(4),
    selectTab6: () => switchGroupByIndex(5),
    selectTab7: () => switchGroupByIndex(6),
    selectTab8: () => switchGroupByIndex(7),
    selectTab9: () => switchGroupByIndex(8),
  };

  useEffect(() => {
    for (const action of WORKSPACE_PREFIX_ACTIONS) {
      prefixKey.setActionHandler(action, () =>
        workspacePrefixActionsRef.current[action]?.(),
      );
    }
    // ⌃B ⌃B sends a literal Ctrl+B byte (0x02) to the focused terminal.
    prefixKey.setLiteralHandler(() => {
      activeCardRef.current?.sendInput("\x02");
    });
    return () => {
      for (const action of WORKSPACE_PREFIX_ACTIONS) {
        prefixKey.clearActionHandler(action);
      }
      prefixKey.setLiteralHandler(null);
    };
  }, [prefixKey]);

  // ---- desktop chrome command channel (TabBar / command palette) ----
  // Handlers change identity every render, so the ref is refilled on every
  // commit rather than memoized.
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = {
      selectGroup: (groupId) => activateGroup(groupId),
      reorderGroups: (sourceGroupId, targetGroupId, placement) =>
        void handleReorderGroups(sourceGroupId, targetGroupId, placement),
      runPrefixAction: (action) =>
        workspacePrefixActionsRef.current[action]?.(),
    };
  });

  useEffect(
    () => () => {
      if (commandsRef) commandsRef.current = {};
    },
    [commandsRef],
  );

  useEffect(() => {
    onActiveGroupChange?.(workspace.activeGroupId);
  }, [onActiveGroupChange, workspace.activeGroupId]);

  // Right-clicking a desktop pane also focuses it (the leaf's onMouseDown),
  // so by the time a menu item is clicked the split/zoom handlers below see
  // that pane as the active one.
  const handlePaneContextMenu = useCallback(
    (terminalId: string, event: ReactMouseEvent<HTMLElement>) => {
      if (isMobile) return;
      event.preventDefault();
      setPaneMenu({ terminalId, x: event.clientX, y: event.clientY });
    },
    [isMobile],
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
          activeTerminal={activeTerminal}
          machineId={commandMachineId}
          isController={isController}
          onOpenDrawer={() => setMobileDrawerOpen(true)}
          onSplitRight={() => void handleSplit("right")}
          onFit={handleFit}
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
          {activeGroup?.layoutMode === "scrollable" &&
          (activeGroup.scrollable?.columns?.length ?? 0) > 0 ? (
            <ScrollableWorkspace
              columns={activeGroup.scrollable?.columns ?? []}
              terminalsById={terminalsById}
              activeTerminalId={activeTerminal?.id ?? null}
              isController={isController}
              deviceId={deviceId}
              isMobile
              fitRequest={fitRequest}
              onActiveRef={(ref) => {
                activeCardRef.current = ref;
              }}
              onFitRequestHandled={handleFitRequestHandled}
              onFocus={activateTerminal}
              onDestroy={handleDestroy}
              onResizeColumn={handleResizeColumn}
              onReorderColumns={handleReorderColumns}
              onRequestControl={onRequestControl}
              onReleaseControl={onReleaseControl}
            />
          ) : activeTerminal ? (
            <WorkspacePaneLeaf
              terminal={activeTerminal}
              isActive
              isController={isController}
              deviceId={deviceId}
              isMobile
              fitRequestNonce={
                fitRequest?.terminalIds.includes(activeTerminal.id)
                  ? fitRequest.nonce
                  : null
              }
              fitRequestShouldFocus={
                fitRequest?.focusTerminalId === activeTerminal.id
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

  const paneMenuTerminal = paneMenu
    ? terminalsById.get(paneMenu.terminalId) ?? null
    : null;
  const paneMenuItems: ContextMenuEntry[] = paneMenuTerminal
    ? [
        {
          label: "Split right",
          shortcut: formatPrefixBinding("splitRight"),
          disabled: !isController,
          onClick: () => void handleSplit("right"),
        },
        {
          label: "Split down",
          shortcut: formatPrefixBinding("splitDown"),
          disabled: !isController,
          onClick: () => void handleSplit("down"),
        },
        {
          label: "Zoom",
          shortcut: formatPrefixBinding("zoomPane"),
          onClick: toggleMaximizeActivePane,
        },
        {
          label: "Fit to window",
          disabled: !isController,
          // Same behaviour as the deleted toolbar Fit button: the pane is
          // already active (right-click focused it), and the fit always
          // emits a resize frame — e2e fit-stability contracts rely on it.
          onClick: handleFit,
        },
        { type: "separator" },
        {
          label: "Move pane to tab",
          disabled: !isController,
          onClick: () => {},
          children: [
            {
              label: "cwd",
              onClick: () => void onAssignGroup(paneMenuTerminal, null),
            },
            ...workspace.groups
              .filter((group) => group.persistent && group.workspaceGroupId)
              .map((group) => ({
                label: group.label,
                onClick: () =>
                  void onAssignGroup(
                    paneMenuTerminal,
                    group.workspaceGroupId ?? null,
                  ),
              })),
          ],
        },
        { type: "separator" },
        {
          label: "Close pane",
          shortcut: formatPrefixBinding("closePane"),
          disabled: !isController,
          onClick: () => handleDestroy(paneMenuTerminal),
        },
      ]
    : [];

  return (
    <div
      data-testid="expanded-terminal"
      style={{
        flex: 1,
        minHeight: 0,
        background: terminalTheme.background,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
              maximizedTerminalId &&
              fitRequest?.terminalIds.includes(maximizedTerminalId)
                ? fitRequest.nonce
                : null
            }
            fitRequestShouldFocus={
              fitRequest?.focusTerminalId === maximizedTerminalId
            }
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFitRequestHandled={handleFitRequestHandled}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onPaneContextMenu={handlePaneContextMenu}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        ) : activeGroup?.layoutMode === "scrollable" &&
          (activeGroup.scrollable?.columns?.length ?? 0) > 0 ? (
          <ScrollableWorkspace
            columns={activeGroup.scrollable?.columns ?? []}
            terminalsById={terminalsById}
            activeTerminalId={activeTerminal?.id ?? null}
            isController={isController}
            deviceId={deviceId}
            isMobile={false}
            fitRequest={fitRequest}
            onActiveRef={(ref) => {
              activeCardRef.current = ref;
            }}
            onFitRequestHandled={handleFitRequestHandled}
            onFocus={activateTerminal}
            onDestroy={handleDestroy}
            onResizeColumn={handleResizeColumn}
            onReorderColumns={handleReorderColumns}
            onPaneContextMenu={handlePaneContextMenu}
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
            onPaneContextMenu={handlePaneContextMenu}
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
      {paneMenu && paneMenuTerminal && (
        <ContextMenu
          x={paneMenu.x}
          y={paneMenu.y}
          items={paneMenuItems}
          onClose={() => setPaneMenu(null)}
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

export const TerminalWorkspace = memo(TerminalWorkspaceComponent);

// Mobile-only top bar (Phase 2 removed the desktop toolbar row; the desktop
// chrome now lives in TabBar). Shows the panes drawer button, the control
// pill, and the mobile icon actions.
function WorkspaceTopBar({
  activeTerminal,
  machineId,
  isController,
  onOpenDrawer,
  onSplitRight,
  onFit,
  onDestroyActive,
  onClose,
  onRequestControl,
  onReleaseControl,
}: {
  activeTerminal: TerminalInfo | null;
  machineId: string;
  isController: boolean;
  onOpenDrawer: () => void;
  onSplitRight: () => void;
  onFit: () => void;
  onDestroyActive: () => void;
  onClose: () => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  const activeTitle =
    activeTerminal?.title || activeTerminal?.id.slice(0, 8) || "No panes";

  return (
    <div
      style={{
        height: 44,
        borderBottom: `1px solid ${colors.lineSoft}`,
        background: colors.bg1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 8px",
        flexShrink: 0,
        minWidth: 0,
      }}
    >
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
  onPaneContextMenu,
  onRequestControl,
  onReleaseControl,
}: {
  node: WorkspacePaneNode;
  terminalsById: Map<string, TerminalInfo>;
  activeTerminalId: string | null;
  isController: boolean;
  deviceId: string;
  fitRequest: WorkspaceFitRequest | null;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number, terminalId: string) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onPaneContextMenu: (
    terminalId: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
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
          fitRequest?.terminalIds.includes(terminal.id)
            ? fitRequest.nonce
            : null
        }
        fitRequestShouldFocus={fitRequest?.focusTerminalId === terminal.id}
        onActiveRef={onActiveRef}
        onFitRequestHandled={onFitRequestHandled}
        onFocus={onFocus}
        onDestroy={onDestroy}
        onPaneContextMenu={onPaneContextMenu}
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
        gap: 1,
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
          onPaneContextMenu={onPaneContextMenu}
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
          onPaneContextMenu={onPaneContextMenu}
          onRequestControl={onRequestControl}
          onReleaseControl={onReleaseControl}
        />
      </div>
    </div>
  );
}

export function WorkspacePaneLeaf({
  terminal,
  isActive,
  isController,
  deviceId,
  isMobile,
  fitRequestNonce,
  fitRequestShouldFocus,
  onActiveRef,
  onFitRequestHandled,
  onFocus,
  onDestroy,
  onPaneContextMenu,
  onRequestControl,
  onReleaseControl,
}: {
  terminal: TerminalInfo;
  isActive: boolean;
  isController: boolean;
  deviceId: string;
  isMobile: boolean;
  fitRequestNonce: number | null;
  fitRequestShouldFocus: boolean;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number, terminalId: string) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onPaneContextMenu?: (
    terminalId: string,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
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
    if (!isController || fitRequestNonce === null) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const card = cardRef.current;
        if (!card) return;
        card.fitToContainer({
          skipIfUnchanged: true,
          focusAfterFit: fitRequestShouldFocus,
        });
        onFitRequestHandled(fitRequestNonce, terminal.id);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [
    fitRequestNonce,
    fitRequestShouldFocus,
    isController,
    onFitRequestHandled,
    terminal.id,
  ]);

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
      onContextMenu={(event) => onPaneContextMenu?.(terminal.id, event)}
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        // Focused pane: subtle 1px accent inner border; unfocused: line.
        border: `1px solid ${isActive ? colorAlpha.accentLine : colors.line}`,
        boxShadow: isActive ? `0 0 0 1px ${colorAlpha.accentLine}` : "none",
        overflow: "hidden",
      }}
    >
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
  placement: GroupDropPlacement,
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
  return moveRelative(
    persistentIds,
    sourceGroupId,
    targetGroupId,
    placement,
    (id) => id,
  );
}

function reorderWorkspaceGroupsForDisplay(
  groups: WorkspaceGroup[],
  sourceGroupId: string,
  targetGroupId: string,
  placement: GroupDropPlacement,
): WorkspaceGroup[] {
  return moveRelative(
    groups,
    sourceGroupId,
    targetGroupId,
    placement,
    (group) => group.id,
  );
}

function moveRelative<T>(
  items: T[],
  sourceGroupId: string,
  targetGroupId: string,
  placement: GroupDropPlacement,
  getId: (item: T) => string,
): T[] {
  const next = items.slice();
  const sourceIndex = next.findIndex((item) => getId(item) === sourceGroupId);
  if (sourceIndex === -1) return items;
  const [source] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex((item) => getId(item) === targetGroupId);
  if (targetIndex === -1) return items;
  next.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, source);
  return next;
}

function containsTerminal(root: WorkspacePaneNode | null, terminalId: string) {
  return collectIds(root).includes(terminalId);
}

function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+/, "~");
}

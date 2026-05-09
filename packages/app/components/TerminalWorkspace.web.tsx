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
  ReactNode,
} from "react";
import type {
  TerminalInfo,
  WorkspaceColumnWidth,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
  WorkspaceLayoutMode,
  WorkspaceLayoutNode,
} from "@webmux/shared";
import {
  ChevronDown,
  Columns2,
  Columns3,
  Expand,
  GripVertical,
  LayoutGrid,
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
  type WorkspacePaneFocusDirection,
  type WorkspacePaneNode,
  type WorkspaceSplitIntent,
  type TerminalWorkspace as TerminalWorkspaceState,
  appendWorkspacePaneToGroup,
  closeWorkspacePane,
  createTerminalWorkspace,
  findAdjacentWorkspacePane,
  getActiveWorkspaceGroup,
  reconcileTerminalWorkspace,
  selectWorkspaceGroup,
  setWorkspaceColumnWidth,
  setWorkspaceLayoutMode,
  splitWorkspacePane,
  swapWorkspacePanes,
} from "@/lib/terminalWorkspaceLayout";
import { ScrollableWorkspace } from "./ScrollableWorkspace";
import {
  findWorkspaceShortcutAction,
  getWorkspaceGroupShortcutIndex,
  isEditableShortcutTarget,
} from "@/lib/workspaceShortcuts";

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
  ) => Promise<WorkspaceLayoutInfo | null | void>;
  onAssignGroup: (
    terminal: TerminalInfo,
    workspaceGroupId: string | null,
  ) => Promise<void>;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}

type GroupDropPlacement = "before" | "after";

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
  const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null);
  const paneDragRef = useRef<{ sourceTerminalId: string } | null>(null);
  const documentPaneDragCleanupRef = useRef<(() => void) | null>(null);
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
            await onSaveWorkspaceLayout(commandMachineId, group.id, group.root);
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

  const handleAssignGroup = useCallback(
    async (workspaceGroupId: string | null) => {
      if (!activeTerminal) return;
      await onAssignGroup(activeTerminal, workspaceGroupId);
    },
    [activeTerminal, onAssignGroup],
  );

  const handleMovePane = useCallback(
    async (sourceTerminalId: string, targetTerminalId: string) => {
      if (!isController || sourceTerminalId === targetTerminalId) return;
      setMaximizedTerminalId(null);
      const before = workspaceRef.current;
      const nextWorkspace = updateWorkspace((current) =>
        swapWorkspacePanes(current, sourceTerminalId, targetTerminalId),
      );
      if (nextWorkspace === before) return;
      const groupId =
        nextWorkspace.groups.find(
          (group) =>
            containsTerminal(group.root, sourceTerminalId) &&
            containsTerminal(group.root, targetTerminalId),
        )?.id ?? nextWorkspace.activeGroupId;
      onPick(sourceTerminalId);
      if (!isMobile) {
        requestPaneFit([sourceTerminalId, targetTerminalId], {
          focusTerminalId: sourceTerminalId,
        });
      }
      await persistGroupLayout(nextWorkspace, groupId);
    },
    [
      isController,
      isMobile,
      onPick,
      persistGroupLayout,
      requestPaneFit,
      updateWorkspace,
    ],
  );

  const handleResizeColumn = useCallback(
    (terminalId: string, width: WorkspaceColumnWidth) => {
      setWorkspace((prev) => setWorkspaceColumnWidth(prev, terminalId, width));
      // Persistence wiring for column width changes is handled in Phase 5 (Task 17).
    },
    [],
  );

  const handleReorderColumns = useCallback(
    (sourceTerminalId: string, targetTerminalId: string) => {
      setWorkspace((prev) => swapWorkspacePanes(prev, sourceTerminalId, targetTerminalId));
    },
    [],
  );

  const handleToggleLayoutMode = useCallback(() => {
    if (!activeGroup) return;
    const nextMode: WorkspaceLayoutMode =
      activeGroup.layoutMode === "scrollable" ? "tiling" : "scrollable";
    setWorkspace((prev) => setWorkspaceLayoutMode(prev, activeGroup.id, nextMode));
    // Persistence wiring lands in Phase 5 (Task 17). For now, in-memory toggle only.
  }, [activeGroup]);

  const removeDocumentPaneDragEnd = useCallback(() => {
    const cleanup = documentPaneDragCleanupRef.current;
    if (!cleanup) return;
    cleanup();
    documentPaneDragCleanupRef.current = null;
  }, []);

  const resetPaneDrag = useCallback(() => {
    removeDocumentPaneDragEnd();
    paneDragRef.current = null;
    setDraggingPaneId(null);
  }, [removeDocumentPaneDragEnd]);

  const finishPaneDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = paneDragRef.current;
      resetPaneDrag();
      if (!drag) return;
      const target = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-workspace-pane-drop-id]");
      const targetTerminalId = target?.dataset.workspacePaneDropId;
      if (!targetTerminalId || targetTerminalId === drag.sourceTerminalId) {
        return;
      }
      void handleMovePane(drag.sourceTerminalId, targetTerminalId);
    },
    [handleMovePane, resetPaneDrag],
  );

  const startPaneMouseDrag = useCallback(
    (sourceTerminalId: string, event: ReactMouseEvent<HTMLElement>) => {
      if (!isController || isMobile || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      removeDocumentPaneDragEnd();
      paneDragRef.current = { sourceTerminalId };
      setDraggingPaneId(sourceTerminalId);
      const handleMouseUp = (mouseEvent: MouseEvent) => {
        removeDocumentPaneDragEnd();
        finishPaneDrag(mouseEvent.clientX, mouseEvent.clientY);
      };
      const handleWindowBlur = () => resetPaneDrag();
      documentPaneDragCleanupRef.current = () => {
        document.removeEventListener("mouseup", handleMouseUp, true);
        window.removeEventListener("blur", handleWindowBlur, true);
      };
      document.addEventListener("mouseup", handleMouseUp, true);
      window.addEventListener("blur", handleWindowBlur, true);
    },
    [
      finishPaneDrag,
      isController,
      isMobile,
      removeDocumentPaneDragEnd,
      resetPaneDrag,
    ],
  );

  useEffect(
    () => () => {
      removeDocumentPaneDragEnd();
    },
    [removeDocumentPaneDragEnd],
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

  useEffect(() => {
    if (isMobile) return;
    const handler = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return;
      const insideTerminal =
        event.target instanceof Element &&
        Boolean(event.target.closest(".xterm"));
      if (!insideTerminal && isEditableShortcutTarget(event.target)) return;

      const action = findWorkspaceShortcutAction(event);
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (action === "paneLeft") {
        focusPaneByDirection("left");
        return;
      }
      if (action === "paneRight") {
        focusPaneByDirection("right");
        return;
      }
      if (action === "paneUp") {
        focusPaneByDirection("up");
        return;
      }
      if (action === "paneDown") {
        focusPaneByDirection("down");
        return;
      }
      if (action === "groupPrevious") {
        switchGroupByOffset(-1);
        return;
      }
      if (action === "groupNext") {
        switchGroupByOffset(1);
        return;
      }

      const groupIndex = getWorkspaceGroupShortcutIndex(action);
      if (groupIndex !== null) switchGroupByIndex(groupIndex);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    focusPaneByDirection,
    isMobile,
    switchGroupByIndex,
    switchGroupByOffset,
  ]);

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

  useEffect(() => {
    if (isMobile) return;
    const handler = (event: KeyboardEvent) => {
      if (event.type !== "keydown") return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey || event.shiftKey || event.code !== "KeyW") return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (activeTerminal) handleDestroy(activeTerminal);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeTerminal, handleDestroy, isMobile]);

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
          layoutMode={activeGroup?.layoutMode ?? "tiling"}
          onToggleLayoutMode={handleToggleLayoutMode}
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
          {activeGroup?.layoutMode === "scrollable" ? (
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
              draggingPaneId={null}
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
        layoutMode={activeGroup?.layoutMode ?? "tiling"}
        onToggleLayoutMode={handleToggleLayoutMode}
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
            draggingPaneId={null}
            onRequestControl={onRequestControl}
            onReleaseControl={onReleaseControl}
          />
        ) : activeGroup?.layoutMode === "scrollable" ? (
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
            draggingPaneId={draggingPaneId}
            onPaneDragStart={startPaneMouseDrag}
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
  layoutMode,
  onToggleLayoutMode,
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
  onReorderGroups: (
    sourceGroupId: string,
    targetGroupId: string,
    placement: GroupDropPlacement,
  ) => void;
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
  layoutMode: WorkspaceLayoutMode;
  onToggleLayoutMode: () => void;
}) {
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const groupDragRef = useRef<{ sourceGroupId: string } | null>(null);
  const documentGroupDragCleanupRef = useRef<(() => void) | null>(null);
  const activeGroup =
    groups.find((group) => group.id === activeGroupId) ?? null;
  const activeTitle =
    activeTerminal?.title || activeTerminal?.id.slice(0, 8) || "No panes";
  const activeCwd = activeTerminal?.cwd ?? activeGroup?.cwd ?? "";
  const removeDocumentGroupDragEnd = useCallback(() => {
    const cleanup = documentGroupDragCleanupRef.current;
    if (!cleanup) return;
    cleanup();
    documentGroupDragCleanupRef.current = null;
  }, []);
  const resetGroupDrag = useCallback(() => {
    removeDocumentGroupDragEnd();
    groupDragRef.current = null;
    setDraggingGroupId(null);
  }, [removeDocumentGroupDragEnd]);
  const finishGroupDrag = useCallback(
    (clientX: number, clientY: number) => {
      const drag = groupDragRef.current;
      resetGroupDrag();
      if (!drag) return;
      const target = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-workspace-group-drop-id]");
      const targetGroupId = target?.dataset.workspaceGroupDropId;
      if (!targetGroupId || targetGroupId === drag.sourceGroupId) return;
      const rect = target.getBoundingClientRect();
      const placement: GroupDropPlacement =
        clientX < rect.left + rect.width / 2 ? "before" : "after";
      onReorderGroups(drag.sourceGroupId, targetGroupId, placement);
    },
    [onReorderGroups, resetGroupDrag],
  );
  const startGroupMouseDrag = useCallback(
    (sourceGroupId: string, event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      removeDocumentGroupDragEnd();
      groupDragRef.current = { sourceGroupId };
      setDraggingGroupId(sourceGroupId);
      const handleMouseUp = (mouseEvent: MouseEvent) => {
        removeDocumentGroupDragEnd();
        finishGroupDrag(mouseEvent.clientX, mouseEvent.clientY);
      };
      const handleWindowBlur = () => resetGroupDrag();
      documentGroupDragCleanupRef.current = () => {
        document.removeEventListener("mouseup", handleMouseUp, true);
        window.removeEventListener("blur", handleWindowBlur, true);
      };
      document.addEventListener("mouseup", handleMouseUp, true);
      window.addEventListener("blur", handleWindowBlur, true);
    },
    [finishGroupDrag, removeDocumentGroupDragEnd, resetGroupDrag],
  );
  useEffect(
    () => () => {
      removeDocumentGroupDragEnd();
    },
    [removeDocumentGroupDragEnd],
  );

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
                data-workspace-group-drop-id={
                  group.persistent ? group.id : undefined
                }
                onMouseEnter={(event) => {
                  if (draggingGroupId) return;
                  if (event.buttons !== 0) return;
                  if (!active) onGroupSelect(group.id);
                }}
                style={{
                  ...groupTabShellStyle,
                  background: active ? colors.bg2 : "transparent",
                  borderColor:
                    active ? colorAlpha.accentLine : colors.lineSoft,
                  cursor: group.persistent ? "default" : "pointer",
                }}
              >
                {group.persistent && (
                  <span
                    role="button"
                    tabIndex={-1}
                    data-testid={`workspace-group-drag-${group.id}`}
                    title="Drag group"
                    aria-label={`Drag group ${group.label}`}
                    onMouseDown={(event) =>
                      startGroupMouseDrag(group.id, event)
                    }
                    style={groupDragHandleStyle}
                  >
                    <GripVertical
                      size={13}
                      style={{ color: colors.fg3, pointerEvents: "none" }}
                    />
                  </span>
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
            );
          })}
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
            title={layoutMode === "scrollable" ? "Switch to tiling" : "Switch to scrollable"}
            testId="layout-mode-toggle"
            onClick={onToggleLayoutMode}
          >
            {layoutMode === "scrollable" ? <Columns3 size={14} /> : <LayoutGrid size={14} />}
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
  draggingPaneId,
  onPaneDragStart,
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
  draggingPaneId: string | null;
  onPaneDragStart: (
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
        draggingPaneId={draggingPaneId}
        onPaneDragStart={onPaneDragStart}
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
          draggingPaneId={draggingPaneId}
          onPaneDragStart={onPaneDragStart}
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
          draggingPaneId={draggingPaneId}
          onPaneDragStart={onPaneDragStart}
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
  draggingPaneId,
  onPaneDragStart,
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
  draggingPaneId: string | null;
  onPaneDragStart?: (
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
      data-workspace-pane-drop-id={!isMobile ? terminal.id : undefined}
      onMouseDown={() => onFocus(terminal.id)}
      onMouseMove={(event) => {
        if (isMobile || isActive || draggingPaneId) return;
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
          {isController && onPaneDragStart && (
            <span
              role="button"
              tabIndex={-1}
              data-testid={`pane-drag-handle-${terminal.id}`}
              title="Drag pane"
              aria-label={`Drag pane ${terminal.title || terminal.id.slice(0, 8)}`}
              onMouseDown={(event) => onPaneDragStart(terminal.id, event)}
              style={paneDragHandleStyle}
            >
              <GripVertical
                size={13}
                style={{ color: colors.fg3, pointerEvents: "none" }}
              />
            </span>
          )}
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

const groupDragHandleStyle: CSSProperties = {
  width: 16,
  height: 20,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: colors.fg3,
  cursor: "grab",
  flexShrink: 0,
  touchAction: "none",
  userSelect: "none",
};

const paneDragHandleStyle: CSSProperties = {
  ...groupDragHandleStyle,
  width: 18,
  height: 22,
  marginLeft: -2,
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

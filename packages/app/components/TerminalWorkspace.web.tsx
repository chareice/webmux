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
  MutableRefObject,
} from "react";
import type {
  TerminalInfo,
  WorkspaceGroupInfo,
  WorkspaceLayoutInfo,
  WorkspaceLayoutNode,
} from "@webmux/shared";
import { Plus } from "lucide-react";
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
  buildReorderPersistentGroupIds,
  closeWorkspacePane,
  createTerminalWorkspace,
  findAdjacentWorkspacePane,
  getActiveWorkspaceGroup,
  reconcileTerminalWorkspace,
  rotateWorkspaceLayout,
  selectWorkspaceGroup,
  splitWorkspacePane,
} from "@/lib/terminalWorkspaceLayout";
import { formatPrefixBinding, type PrefixActionId } from "@/lib/prefixKey";
import { usePrefixKey } from "@/lib/prefixKeyContext";
import { useLongPress } from "@/lib/longPress";

interface TerminalWorkspaceProps {
  terminal: TerminalInfo;
  siblings: TerminalInfo[];
  workspaceGroups: WorkspaceGroupInfo[];
  workspaceLayouts: WorkspaceLayoutInfo[];
  isController: boolean;
  canType: boolean;
  eventsReconnecting: boolean;
  deviceId: string;
  isCompact: boolean;
  isTouch: boolean;
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
  onReorderGroups: (
    machineId: string,
    groupIds: string[],
  ) => Promise<WorkspaceGroupInfo[] | null | void>;
  onSaveWorkspaceLayout: (
    machineId: string,
    groupKey: string,
    root: WorkspaceLayoutNode | null,
  ) => Promise<WorkspaceLayoutInfo | null | void>;
  onAssignGroup: (
    terminal: TerminalInfo,
    workspaceGroupId: string | null,
  ) => Promise<void>;
  // Promote a cwd fallback tab to a persistent group (create the
  // workspace_groups row and move the tab's terminals into it).
  onPromoteGroup: (
    machineId: string,
    name: string,
    terminalIds: string[],
  ) => Promise<WorkspaceGroupInfo | null>;
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

type PaneMenuEvent = {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

// Prefix actions owned by this component (TerminalCanvas owns the rest).
const WORKSPACE_PREFIX_ACTIONS: PrefixActionId[] = [
  "splitRight",
  "splitDown",
  "rotateLayout",
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
  canType,
  eventsReconnecting,
  deviceId,
  isCompact,
  isTouch,
  onPick,
  onDestroy,
  onSplit,
  onCreatePane,
  onReorderGroups,
  onSaveWorkspaceLayout,
  onAssignGroup,
  onPromoteGroup,
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
  const pendingGroupSelectionRef = useRef<string | null>(null);
  const fitRequestCounterRef = useRef(0);
  const [fitRequest, setFitRequest] = useState<WorkspaceFitRequest | null>(
    null,
  );
  const [maximizedTerminalId, setMaximizedTerminalId] = useState<string | null>(
    null,
  );
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
      let next = reconcileTerminalWorkspace(
        prev,
        siblings,
        externalTerminalChanged ? terminal.id : prev.activeTerminalId,
        workspaceGroups,
        workspaceLayouts,
      );
      // Retry a pending selection: selectGroup may be issued from the
      // create-group HTTP response before the workspace_group_created
      // event lands here and reconciles the new group into local state.
      const pendingGroupId = pendingGroupSelectionRef.current;
      if (pendingGroupId) {
        const selected = selectWorkspaceGroup(next, pendingGroupId);
        if (selected !== next) {
          next = selected;
          pendingGroupSelectionRef.current = null;
        }
      }
      workspaceRef.current = next;
      return next;
    });
  }, [siblings, terminal.id, workspaceGroups, workspaceLayouts]);

  const activeGroup = getActiveWorkspaceGroup(workspace);
  const activeTerminal = workspace.activeTerminalId
    ? terminalsById.get(workspace.activeTerminalId) ?? null
    : null;
  const commandMachineId = activeTerminal?.machine_id ?? terminal.machine_id;
  // Panes in the active group — a group with a single pane renders no
  // focused-pane accent border (a lone pane needs no focus indicator).
  const activeGroupPaneCount = activeGroup
    ? collectIds(activeGroup.root).length
    : 0;
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
      if (!isCompact && isController && changedTerminal) {
        requestPaneFit(terminalId, { focusTerminalId: terminalId });
      }
    },
    [
      isController,
      isCompact,
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
      // If the group is not in local state yet (e.g. selectGroup issued from
      // the create-group HTTP response before the workspace_group_created
      // event arrives), remember it and retry from the reconcile effect.
      if (next.activeGroupId !== groupId) {
        pendingGroupSelectionRef.current = groupId;
        return;
      }
      pendingGroupSelectionRef.current = null;
      if (next.activeTerminalId) onPick(next.activeTerminalId);
      if (!isCompact && isController) {
        requestPaneFit(collectIds(getActiveWorkspaceGroup(next)?.root ?? null), {
          focusTerminalId: next.activeTerminalId,
        });
      }
    },
    [isController, isCompact, onPick, requestPaneFit, updateWorkspace],
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

  // ⌃B r: flip every split direction in the active group's layout tree
  // (stacked ↔ side-by-side) without touching pane order or ratios.
  const handleRotateLayout = useCallback(() => {
    if (!isController) return;
    const group = getActiveWorkspaceGroup(workspaceRef.current);
    if (!group || collectIds(group.root).length < 2) return;
    const groupId = group.id;
    const nextWorkspace = updateWorkspace((current) =>
      rotateWorkspaceLayout(current),
    );
    requestPaneFit(collectIds(getActiveWorkspaceGroup(nextWorkspace)?.root ?? null), {
      focusTerminalId: nextWorkspace.activeTerminalId,
    });
    void persistGroupLayout(nextWorkspace, groupId);
  }, [isController, persistGroupLayout, requestPaneFit, updateWorkspace]);

  const handleReorderGroups = useCallback(
    async (
      sourceGroupId: string,
      targetGroupId: string,
      placement: GroupDropPlacement,
    ) => {
      if (sourceGroupId === targetGroupId) return;
      // cwd fallback tabs have no workspace_groups row, so a drop involving
      // one promotes it to a persistent group first. Promotion happens at
      // drop, never at drag start — the tab's id changes during promotion
      // and must stay stable while a drag is in flight.
      const promotedIds: Record<string, string> = {};
      for (const endGroupId of [targetGroupId, sourceGroupId]) {
        // Look the group up fresh each step: the terminal assignments fire
        // terminal_updated events whose reconcile rebuilds the groups
        // (fallback tab out, persistent twin in) while we await.
        const fallbackGroup = workspaceRef.current.groups.find(
          (candidate) => candidate.id === endGroupId && !candidate.persistent,
        );
        if (!fallbackGroup) continue;
        const terminalIds = collectIds(fallbackGroup.root);
        const machineId =
          terminalIds
            .map((id) => terminalsById.get(id)?.machine_id)
            .find((id): id is string => Boolean(id)) ?? commandMachineId;
        const created = await onPromoteGroup(
          machineId,
          fallbackGroup.label,
          terminalIds,
        ).catch((error) => {
          console.error("Failed to promote workspace group", error);
          return null;
        });
        // Promotion failed — abort the reorder, leave everything as-is.
        if (!created) return;
        promotedIds[endGroupId] = created.id;
        // Re-save the pane layout under the new group key only after the
        // terminal assignments: the hub validates layout terminal ids
        // against the group's members. A single-pane tab has a trivial
        // layout; still saved for correctness.
        try {
          await onSaveWorkspaceLayout(machineId, created.id, fallbackGroup.root);
        } catch (error) {
          console.error("Failed to save workspace pane layout", error);
        }
        if (workspaceRef.current.activeGroupId === endGroupId) {
          updateWorkspace((prev) => ({ ...prev, activeGroupId: created.id }));
        }
      }
      const nextIds = buildReorderPersistentGroupIds(
        workspaceRef.current.groups,
        sourceGroupId,
        targetGroupId,
        placement,
        promotedIds,
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
      onPromoteGroup,
      onReorderGroups,
      onSaveWorkspaceLayout,
      siblings,
      terminalsById,
      updateWorkspace,
      workspaceLayouts,
    ],
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

  const toggleMaximizeActivePane = useCallback(() => {
    if (!activeTerminal) return;
    setMaximizedTerminalId((value) =>
      value === activeTerminal.id ? null : activeTerminal.id,
    );
  }, [activeTerminal]);

  workspacePrefixActionsRef.current = {
    splitRight: () => void handleSplit("right"),
    splitDown: () => void handleSplit("down"),
    rotateLayout: handleRotateLayout,
    paneLeft: () => focusPaneByDirection("left"),
    paneRight: () => focusPaneByDirection("right"),
    paneUp: () => focusPaneByDirection("up"),
    paneDown: () => focusPaneByDirection("down"),
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
  // that pane as the active one. Touch uses the same menu via long-press.
  const handlePaneContextMenu = useCallback(
    (terminalId: string, event: PaneMenuEvent) => {
      if (isCompact) return;
      event.preventDefault();
      setPaneMenu({ terminalId, x: event.clientX, y: event.clientY });
    },
    [isCompact],
  );

  // Fold/unfold and inner-screen rotation fire window.resize. Compact chrome
  // refits on mount via the leaf effect; the large workspace must request a
  // fit here because ResizeObserver only remeasures, it does not emit resize
  // frames. Desktop mouse is left alone so existing fit-stability contracts
  // stay intact — only touch workspaces subscribe.
  useEffect(() => {
    if (!isTouch || isCompact || !isController) return;
    const fitVisible = () => {
      const group = getActiveWorkspaceGroup(workspaceRef.current);
      requestPaneFit(collectIds(group?.root ?? null), {
        focusTerminalId: workspaceRef.current.activeTerminalId,
      });
    };
    fitVisible();
    window.addEventListener("resize", fitVisible);
    return () => window.removeEventListener("resize", fitVisible);
  }, [isCompact, isController, isTouch, requestPaneFit]);

  if (isCompact) {
    // Compact P1 shell: the workspace renders chromeless inside
    // MobileWorkbench — the session title bar above and the key bar below (the
    // key bar lives inside TerminalCard) are the only permanent chrome.
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
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {activeTerminal ? (
            <WorkspacePaneLeaf
              terminal={activeTerminal}
              isActive
              isController={isController}
              canType={canType}
              eventsReconnecting={eventsReconnecting}
              deviceId={deviceId}
              isCompact
              isTouch={isTouch}
              focusRing={activeGroupPaneCount > 1}
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
          label: "Rotate layout",
          shortcut: formatPrefixBinding("rotateLayout"),
          disabled: !isController || activeGroupPaneCount < 2,
          onClick: handleRotateLayout,
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
            canType={canType}
            eventsReconnecting={eventsReconnecting}
            deviceId={deviceId}
            isCompact={false}
            isTouch={isTouch}
            focusRing={activeGroupPaneCount > 1}
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
        ) : activeGroup?.root ? (
          <WorkspacePaneTree
            node={activeGroup.root}
            terminalsById={terminalsById}
            activeTerminalId={activeTerminal?.id ?? null}
            isController={isController}
            canType={canType}
            eventsReconnecting={eventsReconnecting}
            deviceId={deviceId}
            isTouch={isTouch}
            focusRing={activeGroupPaneCount > 1}
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
    </div>
  );
}

export const TerminalWorkspace = memo(TerminalWorkspaceComponent);

function WorkspacePaneTree({
  node,
  terminalsById,
  activeTerminalId,
  isController,
  canType,
  eventsReconnecting,
  deviceId,
  isTouch,
  focusRing = true,
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
  canType: boolean;
  eventsReconnecting: boolean;
  deviceId: string;
  isTouch: boolean;
  focusRing?: boolean;
  fitRequest: WorkspaceFitRequest | null;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number, terminalId: string) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onPaneContextMenu: (
    terminalId: string,
    event: PaneMenuEvent,
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
        canType={canType}
        eventsReconnecting={eventsReconnecting}
        deviceId={deviceId}
        isCompact={false}
        isTouch={isTouch}
        focusRing={focusRing}
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
  // Touch workspaces (Fold inner screen, ~760-840 CSS px wide) render every
  // split stacked as a single column: side-by-side terminals get ~40 cols
  // each, too narrow to read. Only the rendering is overridden — the split
  // direction persisted on the hub is untouched, so the same group keeps its
  // saved side-by-side arrangement on desktop clients.
  const row = !isTouch && node.direction === "horizontal";
  const treeProps = {
    terminalsById,
    activeTerminalId,
    isController,
    canType,
    eventsReconnecting,
    deviceId,
    isTouch,
    focusRing,
    fitRequest,
    onActiveRef,
    onFitRequestHandled,
    onFocus,
    onDestroy,
    onPaneContextMenu,
    onRequestControl,
    onReleaseControl,
  };
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
        <WorkspacePaneTree node={node.first} {...treeProps} />
      </div>
      <div style={{ flex: 1 - node.ratio, minWidth: 0, minHeight: 0 }}>
        <WorkspacePaneTree node={node.second} {...treeProps} />
      </div>
    </div>
  );
}

export function WorkspacePaneLeaf({
  terminal,
  isActive,
  isController,
  canType,
  eventsReconnecting,
  deviceId,
  isCompact,
  isTouch,
  focusRing = true,
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
  canType: boolean;
  eventsReconnecting: boolean;
  deviceId: string;
  isCompact: boolean;
  isTouch: boolean;
  // False when the group has a single pane — a lone pane renders the plain
  // line border instead of the focused-pane accent ring.
  focusRing?: boolean;
  fitRequestNonce: number | null;
  fitRequestShouldFocus: boolean;
  onActiveRef: (ref: TerminalCardRef | null) => void;
  onFitRequestHandled: (nonce: number, terminalId: string) => void;
  onFocus: (id: string) => void;
  onDestroy: (terminal: TerminalInfo) => void;
  onPaneContextMenu?: (
    terminalId: string,
    event: PaneMenuEvent,
  ) => void;
  onRequestControl?: (machineId: string) => void;
  onReleaseControl?: (machineId: string) => void;
}) {
  const cardRef = useRef<TerminalCardRef>(null);
  const longPress = useLongPress((point) => {
    onFocus(terminal.id);
    onPaneContextMenu?.(terminal.id, {
      clientX: point.x,
      clientY: point.y,
      preventDefault: () => {},
    });
  }, Boolean(isTouch && onPaneContextMenu));

  useEffect(() => {
    if (!isActive) return;
    const frame = requestAnimationFrame(() => {
      if (isCompact && isController) {
        cardRef.current?.fitToContainer({ skipIfUnchanged: true });
      } else if (canType && !isTouch) {
        cardRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [canType, isActive, isCompact, isController, isTouch, terminal.id]);

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
        if (isTouch || isActive) return;
        const target = event.target;
        if (target instanceof Element && target.closest("button")) return;
        onFocus(terminal.id);
      }}
      onContextMenu={(event) => onPaneContextMenu?.(terminal.id, event)}
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-testid="terminal-select-overlay"]')
        ) {
          return;
        }
        longPress.onPointerDown(event);
      }}
      onPointerMove={longPress.onPointerMove}
      onPointerUp={longPress.onPointerUp}
      onPointerCancel={longPress.onPointerCancel}
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: colors.bg0,
        // Focused pane: subtle 1px accent inner border; unfocused (or lone
        // pane in a single-pane group): plain line.
        border: `1px solid ${
          isActive && focusRing ? colorAlpha.accentLine : colors.line
        }`,
        boxShadow:
          isActive && focusRing
            ? `0 0 0 1px ${colorAlpha.accentLine}`
            : "none",
        overflow: "hidden",
      }}
    >
      <TerminalCard
        ref={cardRef}
        terminal={terminal}
        displayMode="tab"
        isCompact={isCompact}
        isTouch={isTouch}
        isActive={isActive}
        isController={isController}
        canType={canType}
        eventsReconnecting={eventsReconnecting}
        reconnectIndicatorActive={isActive}
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

function collectIds(root: WorkspacePaneNode | null): string[] {
  if (!root) return [];
  if (root.type === "leaf") return [root.terminalId];
  return [...collectIds(root.first), ...collectIds(root.second)];
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

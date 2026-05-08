import type { TerminalInfo, WorkspaceGroupInfo } from "@webmux/shared";

export type WorkspaceSplitDirection = "horizontal" | "vertical";
export type WorkspaceSplitIntent = "right" | "down";

export type WorkspacePaneNode =
  | { type: "leaf"; terminalId: string }
  | {
      type: "split";
      direction: WorkspaceSplitDirection;
      ratio: number;
      first: WorkspacePaneNode;
      second: WorkspacePaneNode;
    };

export interface WorkspaceGroup {
  id: string;
  label: string;
  cwd: string;
  workspaceGroupId: string | null;
  persistent: boolean;
  root: WorkspacePaneNode | null;
  paneCount: number;
}

export interface TerminalWorkspace {
  groups: WorkspaceGroup[];
  activeGroupId: string | null;
  activeTerminalId: string | null;
}

export interface MobileWorkspaceTab {
  id: string;
  label: string;
  cwd: string;
  active: boolean;
}

interface RemoveResult {
  root: WorkspacePaneNode | null;
  fallbackTerminalId: string | null;
  removed: boolean;
}

export function createTerminalWorkspace(
  terminals: TerminalInfo[],
  activeTerminalId: string | null,
  workspaceGroups: WorkspaceGroupInfo[] = [],
): TerminalWorkspace {
  const groups = createGroups(terminals, workspaceGroups);
  const activeGroup =
    groups.find((group) =>
      collectPaneTerminalIds(group.root).includes(activeTerminalId ?? ""),
    ) ??
    groups[0] ??
    null;
  const activeTerminal =
    activeTerminalId && terminalExists(terminals, activeTerminalId)
      ? activeTerminalId
      : firstTerminalId(activeGroup?.root ?? null);

  return {
    groups,
    activeGroupId: activeGroup?.id ?? null,
    activeTerminalId: activeTerminal,
  };
}

export function splitWorkspacePane(
  workspace: TerminalWorkspace,
  input: {
    activeTerminalId: string;
    newTerminalId: string;
    direction: WorkspaceSplitIntent;
  },
): TerminalWorkspace {
  const group = workspace.groups.find((candidate) =>
    collectPaneTerminalIds(candidate.root).includes(input.activeTerminalId),
  );
  if (!group) return workspace;

  const direction: WorkspaceSplitDirection =
    input.direction === "right" ? "horizontal" : "vertical";
  const sourceRoot = removeNode(group.root, input.newTerminalId) ?? group.root;
  const nextRoot = splitNode(
    sourceRoot,
    input.activeTerminalId,
    {
      type: "leaf",
      terminalId: input.newTerminalId,
    },
    direction,
  );
  const groups = workspace.groups.map((candidate) =>
    candidate.id === group.id
      ? {
          ...candidate,
          root: nextRoot,
          paneCount: collectPaneTerminalIds(nextRoot).length,
        }
      : candidate,
  );

  return {
    groups,
    activeGroupId: group.id,
    activeTerminalId: input.newTerminalId,
  };
}

export function appendWorkspacePaneToGroup(
  workspace: TerminalWorkspace,
  input: {
    groupId: string;
    newTerminalId: string;
  },
): TerminalWorkspace {
  const group = workspace.groups.find((candidate) => candidate.id === input.groupId);
  if (!group) return workspace;
  const groups = workspace.groups.map((candidate) => {
    if (candidate.id !== group.id) return candidate;
    const root = appendNode(candidate.root, {
      type: "leaf",
      terminalId: input.newTerminalId,
    });
    return {
      ...candidate,
      root,
      paneCount: collectPaneTerminalIds(root).length,
    };
  });
  return {
    groups,
    activeGroupId: group.id,
    activeTerminalId: input.newTerminalId,
  };
}

export function closeWorkspacePane(
  workspace: TerminalWorkspace,
  terminalId: string,
): TerminalWorkspace {
  let nextActiveTerminalId = workspace.activeTerminalId;
  const groups = workspace.groups
    .map((group) => {
      if (!collectPaneTerminalIds(group.root).includes(terminalId)) {
        return group;
      }
      const result = removeNodeWithFallback(group.root, terminalId);
      const nextRoot = result.root;
      const paneIds = collectPaneTerminalIds(nextRoot);
      if (workspace.activeTerminalId === terminalId) {
        nextActiveTerminalId =
          result.fallbackTerminalId ?? paneIds[0] ?? null;
      }
      return {
        ...group,
        root: nextRoot,
        paneCount: paneIds.length,
      };
    })
    .filter((group) => group.persistent || group.paneCount > 0);

  const activeGroup =
    groups.find((group) =>
      collectPaneTerminalIds(group.root).includes(nextActiveTerminalId ?? ""),
    ) ??
    groups.find((group) => group.id === workspace.activeGroupId) ??
    groups[0] ??
    null;

  return {
    groups,
    activeGroupId: activeGroup?.id ?? null,
    activeTerminalId:
      nextActiveTerminalId ?? firstTerminalId(activeGroup?.root ?? null),
  };
}

export function reconcileTerminalWorkspace(
  workspace: TerminalWorkspace,
  terminals: TerminalInfo[],
  activeTerminalId: string | null,
  workspaceGroups: WorkspaceGroupInfo[] = [],
): TerminalWorkspace {
  const grouped = createGroups(terminals, workspaceGroups);
  let fallbackForRemovedActive: string | null = null;
  const groups = grouped.map((group) => {
    const previous = workspace.groups.find(
      (candidate) => candidate.id === group.id,
    );
    if (!previous) return group;

    const groupTerminalIds = new Set(collectPaneTerminalIds(group.root));
    let root = previous.root;
    for (const id of collectPaneTerminalIds(root)) {
      if (!groupTerminalIds.has(id)) {
        const result = removeNodeWithFallback(root, id);
        root = result.root;
        if (id === workspace.activeTerminalId || id === activeTerminalId) {
          fallbackForRemovedActive =
            fallbackForRemovedActive ?? result.fallbackTerminalId;
        }
      }
    }
    const existingIds = new Set(collectPaneTerminalIds(root));
    for (const id of collectPaneTerminalIds(group.root)) {
      if (!existingIds.has(id)) {
        root = appendNode(root, { type: "leaf", terminalId: id });
        existingIds.add(id);
      }
    }
    return {
      ...group,
      root,
      paneCount: collectPaneTerminalIds(root).length,
    };
  });

  const requestedActive =
    activeTerminalId && terminalExists(terminals, activeTerminalId)
      ? activeTerminalId
      : workspace.activeTerminalId &&
          terminalExists(terminals, workspace.activeTerminalId)
        ? workspace.activeTerminalId
        : fallbackForRemovedActive &&
            terminalExists(terminals, fallbackForRemovedActive)
          ? fallbackForRemovedActive
          : null;
  const activeGroup =
    groups.find((group) =>
      collectPaneTerminalIds(group.root).includes(requestedActive ?? ""),
    ) ??
    groups.find((group) => group.id === workspace.activeGroupId) ??
    groups[0] ??
    null;

  return {
    groups,
    activeGroupId: activeGroup?.id ?? null,
    activeTerminalId:
      requestedActive ?? firstTerminalId(activeGroup?.root ?? null),
  };
}

export function selectWorkspaceGroup(
  workspace: TerminalWorkspace,
  groupId: string,
): TerminalWorkspace {
  const group = workspace.groups.find((candidate) => candidate.id === groupId);
  if (!group) return workspace;
  return {
    ...workspace,
    activeGroupId: group.id,
    activeTerminalId: firstTerminalId(group.root),
  };
}

export function getActiveWorkspaceGroup(
  workspace: TerminalWorkspace,
): WorkspaceGroup | null {
  return (
    workspace.groups.find((group) => group.id === workspace.activeGroupId) ??
    null
  );
}

export function getMobileWorkspaceTabs(
  workspace: TerminalWorkspace,
): MobileWorkspaceTab[] {
  const group = getActiveWorkspaceGroup(workspace);
  if (!group) return [];
  return collectPaneTerminalIds(group.root).map((id) => ({
    id,
    label: `Terminal ${id}`,
    cwd: group.cwd,
    active: workspace.activeTerminalId === id,
  }));
}

export function collectPaneTerminalIds(root: WorkspacePaneNode | null): string[] {
  if (!root) return [];
  if (root.type === "leaf") return [root.terminalId];
  return [
    ...collectPaneTerminalIds(root.first),
    ...collectPaneTerminalIds(root.second),
  ];
}

function createGroups(
  terminals: TerminalInfo[],
  workspaceGroups: WorkspaceGroupInfo[] = [],
): WorkspaceGroup[] {
  const byGroup = new Map<
    string,
    {
      id: string;
      label: string;
      cwd: string;
      workspaceGroupId: string | null;
      persistent: boolean;
      order: number;
      terminals: TerminalInfo[];
    }
  >();
  const sortedWorkspaceGroups = [...workspaceGroups].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  for (const group of sortedWorkspaceGroups) {
    byGroup.set(group.id, {
      id: group.id,
      label: group.name,
      cwd: "",
      workspaceGroupId: group.id,
      persistent: true,
      order: group.sort_order,
      terminals: [],
    });
  }

  for (const terminal of terminals) {
    const workspaceGroupId = terminal.workspace_group_id;
    const persistedGroup =
      workspaceGroupId && byGroup.get(workspaceGroupId)?.persistent
        ? byGroup.get(workspaceGroupId)
        : null;
    if (persistedGroup) {
      if (!persistedGroup.cwd) persistedGroup.cwd = terminal.cwd;
      persistedGroup.terminals.push(terminal);
      continue;
    }

    const key = `cwd:${terminal.cwd}`;
    const fallbackGroup =
      byGroup.get(key) ??
      {
        id: key,
        label: labelFromCwd(terminal.cwd),
        cwd: terminal.cwd,
        workspaceGroupId: null,
        persistent: false,
        order: sortedWorkspaceGroups.length + byGroup.size,
        terminals: [],
      };
    fallbackGroup.terminals.push(terminal);
    byGroup.set(key, fallbackGroup);
  }

  return Array.from(byGroup.values())
    .sort((a, b) => a.order - b.order)
    .map((group) => {
      const root = tileTerminals(
        group.terminals.map((terminal) => terminal.id),
      );
      const cwd =
        group.cwd ||
        group.terminals.find((terminal) => terminal.cwd)?.cwd ||
        "";
      return {
        id: group.id,
        label: group.label,
        cwd,
        workspaceGroupId: group.workspaceGroupId,
        persistent: group.persistent,
        root,
        paneCount: group.terminals.length,
      };
    });
}

function tileTerminals(ids: string[]): WorkspacePaneNode | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return { type: "leaf", terminalId: ids[0] };
  const [first, ...rest] = ids;
  return {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "leaf", terminalId: first },
    second: tileTerminals(rest) ?? { type: "leaf", terminalId: first },
  };
}

function splitNode(
  root: WorkspacePaneNode | null,
  activeTerminalId: string,
  inserted: WorkspacePaneNode,
  direction: WorkspaceSplitDirection,
): WorkspacePaneNode | null {
  if (!root) return inserted;
  if (root.type === "leaf") {
    if (root.terminalId !== activeTerminalId) return root;
    return {
      type: "split",
      direction,
      ratio: 0.5,
      first: root,
      second: inserted,
    };
  }
  return {
    ...root,
    first:
      splitNode(root.first, activeTerminalId, inserted, direction) ??
      root.first,
    second:
      splitNode(root.second, activeTerminalId, inserted, direction) ??
      root.second,
  };
}

function removeNode(
  root: WorkspacePaneNode | null,
  terminalId: string,
): WorkspacePaneNode | null {
  return removeNodeWithFallback(root, terminalId).root;
}

function removeNodeWithFallback(
  root: WorkspacePaneNode | null,
  terminalId: string,
): RemoveResult {
  if (!root) return { root: null, fallbackTerminalId: null, removed: false };
  if (root.type === "leaf") {
    return root.terminalId === terminalId
      ? { root: null, fallbackTerminalId: null, removed: true }
      : { root, fallbackTerminalId: null, removed: false };
  }
  const first = removeNodeWithFallback(root.first, terminalId);
  const second = removeNodeWithFallback(root.second, terminalId);
  if (!first.removed && !second.removed) {
    return { root, fallbackTerminalId: null, removed: false };
  }
  if (!first.root) {
    return {
      root: second.root,
      fallbackTerminalId:
        first.fallbackTerminalId ?? firstTerminalId(second.root),
      removed: true,
    };
  }
  if (!second.root) {
    return {
      root: first.root,
      fallbackTerminalId:
        second.fallbackTerminalId ?? firstTerminalId(first.root),
      removed: true,
    };
  }
  return {
    root: { ...root, first: first.root, second: second.root },
    fallbackTerminalId:
      first.removed ? first.fallbackTerminalId : second.fallbackTerminalId,
    removed: true,
  };
}

function appendNode(
  root: WorkspacePaneNode | null,
  inserted: WorkspacePaneNode,
): WorkspacePaneNode {
  if (!root) return inserted;
  return {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: root,
    second: inserted,
  };
}

function firstTerminalId(root: WorkspacePaneNode | null): string | null {
  return collectPaneTerminalIds(root)[0] ?? null;
}

function terminalExists(terminals: TerminalInfo[], id: string): boolean {
  return terminals.some((terminal) => terminal.id === id);
}

function labelFromCwd(cwd: string): string {
  const cleaned = cwd.replace(/\/+$/, "");
  const tail = cleaned.split("/").filter(Boolean).at(-1);
  return tail || cwd || "workspace";
}

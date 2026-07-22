import { describe, expect, it } from "vitest";
import type { TerminalInfo } from "@webmux/shared";
import {
  appendWorkspacePaneToGroup,
  closeWorkspacePane,
  collectGroupPaneTerminalIds,
  collectPaneTerminalIds,
  createTerminalWorkspace,
  getActiveWorkspaceGroup,
  findAdjacentWorkspacePane,
  getMobileWorkspaceTabs,
  reconcileTerminalWorkspace,
  selectWorkspaceGroup,
  splitWorkspacePane,
  swapWorkspacePanes,
  workspacePaneOrder,
} from "./terminalWorkspaceLayout";
import type { WorkspacePaneNode } from "./terminalWorkspaceLayout";

function terminal(id: string, cwd: string): TerminalInfo {
  return {
    id,
    machine_id: "m1",
    title: `Terminal ${id}`,
    cwd,
    cols: 120,
    rows: 40,
    reachable: true,
  };
}

function groupedTerminal(
  id: string,
  cwd: string,
  workspaceGroupId: string | null,
): TerminalInfo {
  return {
    ...terminal(id, cwd),
    workspace_group_id: workspaceGroupId,
  } as TerminalInfo;
}

describe("terminalWorkspaceLayout", () => {
  const terminals = [
    terminal("web-1", "/home/chareice/projects/webmux"),
    terminal("web-2", "/home/chareice/projects/webmux"),
    terminal("api-1", "/home/chareice/projects/zhuyang"),
  ];

  it("groups terminals by working directory and activates the selected terminal's group", () => {
    const workspace = createTerminalWorkspace(terminals, "api-1");

    expect(workspace.activeGroupId).toBe(
      "cwd:/home/chareice/projects/zhuyang",
    );
    expect(workspace.groups.map((group) => group.label)).toEqual([
      "webmux",
      "zhuyang",
    ]);
    expect(workspace.groups.map((group) => group.paneCount)).toEqual([2, 1]);
    expect(collectPaneTerminalIds(workspace.groups[0].root)).toEqual([
      "web-1",
      "web-2",
    ]);
  });

  it("keeps cwd fallback group order stable when terminal snapshots arrive in a different order", () => {
    const firstSnapshot = createTerminalWorkspace(
      [
        terminal("api-1", "/home/chareice/projects/zhuyang"),
        terminal("web-1", "/home/chareice/projects/webmux"),
        terminal("ops-1", "/home/chareice/projects/ops"),
      ],
      "api-1",
    );
    const secondSnapshot = createTerminalWorkspace(
      [
        terminal("ops-1", "/home/chareice/projects/ops"),
        terminal("web-1", "/home/chareice/projects/webmux"),
        terminal("api-1", "/home/chareice/projects/zhuyang"),
      ],
      "api-1",
    );

    expect(firstSnapshot.groups.map((group) => group.label)).toEqual([
      "ops",
      "webmux",
      "zhuyang",
    ]);
    expect(secondSnapshot.groups.map((group) => group.label)).toEqual(
      firstSnapshot.groups.map((group) => group.label),
    );
  });

  it("restores a persisted pane layout when creating a fresh workspace", () => {
    const workspace = createTerminalWorkspace(
      [terminal("a", "/repo"), terminal("b", "/repo"), terminal("c", "/repo")],
      "c",
      [],
      [
        {
          machine_id: "m1",
          group_key: "cwd:/repo",
          updated_at: 10,
          root: {
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            first: {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              first: { type: "leaf", terminalId: "a" },
              second: { type: "leaf", terminalId: "c" },
            },
            second: { type: "leaf", terminalId: "b" },
          },
        },
      ],
    );

    const root = getActiveWorkspaceGroup(workspace)?.root ?? null;
    expect(collectPaneTerminalIds(root)).toEqual(["a", "c", "b"]);
    expect(root).toMatchObject({
      type: "split",
      direction: "horizontal",
      first: {
        type: "split",
        direction: "vertical",
        first: { type: "leaf", terminalId: "a" },
        second: { type: "leaf", terminalId: "c" },
      },
      second: { type: "leaf", terminalId: "b" },
    });
  });

  it("restores a persisted workspace tab pane layout", () => {
    const workspace = createTerminalWorkspace(
      [
        groupedTerminal("a", "/repo", "tab-main"),
        groupedTerminal("b", "/repo", "tab-main"),
        groupedTerminal("c", "/repo", "tab-main"),
      ],
      "a",
      [{ id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 }],
      [
        {
          machine_id: "m1",
          group_key: "tab-main",
          updated_at: 11,
          root: {
            type: "split",
            direction: "vertical",
            ratio: 0.55,
            first: { type: "leaf", terminalId: "b" },
            second: {
              type: "split",
              direction: "horizontal",
              ratio: 0.45,
              first: { type: "leaf", terminalId: "c" },
              second: { type: "leaf", terminalId: "a" },
            },
          },
        },
      ],
    );

    const root = getActiveWorkspaceGroup(workspace)?.root ?? null;
    expect(collectPaneTerminalIds(root)).toEqual(["b", "c", "a"]);
    expect(root).toMatchObject({
      type: "split",
      direction: "vertical",
      first: { type: "leaf", terminalId: "b" },
      second: {
        type: "split",
        direction: "horizontal",
        first: { type: "leaf", terminalId: "c" },
        second: { type: "leaf", terminalId: "a" },
      },
    });
  });

  it("groups panes by persisted workspace tab before falling back to cwd", () => {
    const workspace = createTerminalWorkspace(
      [
        groupedTerminal("web-1", "/home/chareice/projects/webmux", "tab-agents"),
        groupedTerminal("api-1", "/home/chareice/projects/zhuyang", "tab-agents"),
        terminal("ops-1", "/home/chareice/projects/ops"),
      ],
      "api-1",
      [
        {
          id: "tab-agents",
          machine_id: "m1",
          name: "Agents",
          sort_order: 0,
        },
      ],
    );

    expect(workspace.activeGroupId).toBe("tab-agents");
    expect(workspace.groups.map((group) => group.label)).toEqual([
      "Agents",
      "ops",
    ]);
    expect(collectPaneTerminalIds(workspace.groups[0].root)).toEqual([
      "web-1",
      "api-1",
    ]);
  });

  it("keeps empty persisted workspace tabs visible after reconcile", () => {
    const workspace = createTerminalWorkspace(
      [groupedTerminal("web-1", "/repo", "tab-main")],
      "web-1",
      [
        { id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 },
        { id: "tab-empty", machine_id: "m1", name: "Scratch", sort_order: 1 },
      ],
    );

    const next = reconcileTerminalWorkspace(
      workspace,
      [],
      null,
      [
        { id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 },
        { id: "tab-empty", machine_id: "m1", name: "Scratch", sort_order: 1 },
      ],
    );

    expect(next.groups.map((group) => [group.id, group.paneCount])).toEqual([
      ["tab-main", 0],
      ["tab-empty", 0],
    ]);
  });

  it("keeps a persisted workspace tab visible after closing its last pane", () => {
    const workspace = createTerminalWorkspace(
      [groupedTerminal("web-1", "/repo", "tab-main")],
      "web-1",
      [{ id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 }],
    );

    const next = closeWorkspacePane(workspace, "web-1");

    expect(next.groups.map((group) => [group.id, group.paneCount])).toEqual([
      ["tab-main", 0],
    ]);
  });

  it("keeps the active cwd group visible after closing its last pane", () => {
    const workspace = createTerminalWorkspace([terminal("web-1", "/repo")], "web-1");

    const closed = closeWorkspacePane(workspace, "web-1");
    const reconciled = reconcileTerminalWorkspace(closed, [], closed.activeTerminalId);

    expect(closed.groups.map((group) => [group.id, group.paneCount])).toEqual([
      ["cwd:/repo", 0],
    ]);
    expect(closed.activeGroupId).toBe("cwd:/repo");
    expect(closed.activeTerminalId).toBeNull();
    expect(reconciled.groups.map((group) => [group.id, group.paneCount]))
      .toEqual([["cwd:/repo", 0]]);
    expect(reconciled.activeGroupId).toBe("cwd:/repo");
    expect(reconciled.activeTerminalId).toBeNull();
  });

  it("keeps the active cwd group visible when the last terminal disappears before close applies", () => {
    const workspace = createTerminalWorkspace([terminal("web-1", "/root")], "web-1");

    const reconciled = reconcileTerminalWorkspace(workspace, [], "web-1");

    expect(reconciled.groups.map((group) => [group.id, group.paneCount]))
      .toEqual([["cwd:/root", 0]]);
    expect(reconciled.groups[0].root).toBeNull();
    expect(reconciled.activeGroupId).toBe("cwd:/root");
    expect(reconciled.activeTerminalId).toBeNull();
  });

  it("keeps an empty persisted workspace tab active without falling back to another terminal", () => {
    const workspace = createTerminalWorkspace(
      [groupedTerminal("web-1", "/repo", "tab-main")],
      "web-1",
      [
        { id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 },
        { id: "tab-empty", machine_id: "m1", name: "Scratch", sort_order: 1 },
      ],
    );

    const selected = selectWorkspaceGroup(workspace, "tab-empty");
    const reconciled = reconcileTerminalWorkspace(
      selected,
      [groupedTerminal("web-1", "/repo", "tab-main")],
      selected.activeTerminalId,
      [
        { id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 },
        { id: "tab-empty", machine_id: "m1", name: "Scratch", sort_order: 1 },
      ],
    );

    expect(reconciled.activeGroupId).toBe("tab-empty");
    expect(reconciled.activeTerminalId).toBeNull();
  });

  it("can add the first pane to an empty persisted workspace tab", () => {
    const workspace = createTerminalWorkspace(
      [groupedTerminal("web-1", "/repo", "tab-main")],
      "web-1",
      [
        { id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 },
        { id: "tab-empty", machine_id: "m1", name: "Scratch", sort_order: 1 },
      ],
    );
    const selected = selectWorkspaceGroup(workspace, "tab-empty");

    const next = appendWorkspacePaneToGroup(selected, {
      groupId: "tab-empty",
      newTerminalId: "web-2",
    });

    expect(next.activeGroupId).toBe("tab-empty");
    expect(next.activeTerminalId).toBe("web-2");
    expect(
      collectPaneTerminalIds(
        next.groups.find((group) => group.id === "tab-empty")?.root ?? null,
      ),
    ).toEqual(["web-2"]);
  });

  it("does not duplicate a pane that is already present in the group", () => {
    const workspace = createTerminalWorkspace(
      [groupedTerminal("web-1", "/repo", "tab-main")],
      "web-1",
      [
        { id: "tab-main", machine_id: "m1", name: "Main", sort_order: 0 },
        { id: "tab-empty", machine_id: "m1", name: "Scratch", sort_order: 1 },
      ],
    );
    const selected = selectWorkspaceGroup(workspace, "tab-empty");
    const appended = appendWorkspacePaneToGroup(selected, {
      groupId: "tab-empty",
      newTerminalId: "web-2",
    });

    const next = appendWorkspacePaneToGroup(appended, {
      groupId: "tab-empty",
      newTerminalId: "web-2",
    });

    expect(next).toBe(appended);
    expect(
      collectPaneTerminalIds(
        next.groups.find((group) => group.id === "tab-empty")?.root ?? null,
      ),
    ).toEqual(["web-2"]);
  });

  it("splits the active pane without moving terminals to another group", () => {
    const workspace = createTerminalWorkspace(terminals, "web-1");
    const next = splitWorkspacePane(workspace, {
      activeTerminalId: "web-1",
      newTerminalId: "web-3",
      direction: "right",
    });
    const activeGroup = getActiveWorkspaceGroup(next);

    expect(activeGroup?.label).toBe("webmux");
    expect(activeGroup?.root).toMatchObject({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: {
        type: "split",
        first: { type: "leaf", terminalId: "web-1" },
        second: { type: "leaf", terminalId: "web-3" },
      },
      second: { type: "leaf", terminalId: "web-2" },
    });
    expect(collectPaneTerminalIds(activeGroup?.root ?? null)).toEqual([
      "web-1",
      "web-3",
      "web-2",
    ]);
    expect(next.activeTerminalId).toBe("web-3");
  });

  it("moves an already appended terminal into the requested split instead of duplicating it", () => {
    const workspace = createTerminalWorkspace(
      [
        terminal("web-1", "/repo"),
        terminal("web-2", "/repo"),
      ],
      "web-1",
    );

    const next = splitWorkspacePane(workspace, {
      activeTerminalId: "web-1",
      newTerminalId: "web-2",
      direction: "right",
    });

    expect(
      collectPaneTerminalIds(getActiveWorkspaceGroup(next)?.root ?? null),
    ).toEqual(["web-1", "web-2"]);
  });

  it("swaps two panes inside the active split tree", () => {
    const base = createTerminalWorkspace(
      [
        terminal("left", "/repo"),
        terminal("top", "/repo"),
        terminal("bottom", "/repo"),
      ],
      "bottom",
    );
    const nested = splitWorkspacePane(base, {
      activeTerminalId: "top",
      newTerminalId: "bottom",
      direction: "down",
    });

    const next = swapWorkspacePanes(nested, "left", "bottom");

    expect(next.activeTerminalId).toBe("left");
    expect(getActiveWorkspaceGroup(next)?.root).toMatchObject({
      type: "split",
      first: { type: "leaf", terminalId: "bottom" },
      second: {
        type: "split",
        direction: "vertical",
        first: { type: "leaf", terminalId: "top" },
        second: { type: "leaf", terminalId: "left" },
      },
    });
    expect(collectPaneTerminalIds(getActiveWorkspaceGroup(next)?.root ?? null))
      .toEqual(["bottom", "top", "left"]);
  });

  it("collapses a split when a pane is closed", () => {
    const workspace = splitWorkspacePane(
      createTerminalWorkspace([terminal("a", "/repo")], "a"),
      {
        activeTerminalId: "a",
        newTerminalId: "b",
        direction: "down",
      },
    );

    const next = closeWorkspacePane(workspace, "b");

    expect(getActiveWorkspaceGroup(next)?.root).toEqual({
      type: "leaf",
      terminalId: "a",
    });
    expect(next.activeTerminalId).toBe("a");
  });

  it("activates the adjacent pane when closing an active pane in a nested split", () => {
    const base = createTerminalWorkspace(
      [
        terminal("a", "/repo"),
        terminal("b", "/repo"),
        terminal("c", "/repo"),
      ],
      "b",
    );
    const nested = splitWorkspacePane(base, {
      activeTerminalId: "b",
      newTerminalId: "c",
      direction: "down",
    });

    const next = closeWorkspacePane(nested, "c");

    expect(next.activeTerminalId).toBe("b");
    expect(collectPaneTerminalIds(getActiveWorkspaceGroup(next)?.root ?? null))
      .toEqual(["a", "b"]);
  });

  it("activates the adjacent pane when refresh removes the active pane", () => {
    const base = createTerminalWorkspace(
      [
        terminal("a", "/repo"),
        terminal("b", "/repo"),
        terminal("c", "/repo"),
      ],
      "b",
    );
    const nested = splitWorkspacePane(base, {
      activeTerminalId: "b",
      newTerminalId: "c",
      direction: "down",
    });

    const next = reconcileTerminalWorkspace(
      nested,
      [terminal("a", "/repo"), terminal("b", "/repo")],
      "c",
    );

    expect(next.activeTerminalId).toBe("b");
    expect(collectPaneTerminalIds(getActiveWorkspaceGroup(next)?.root ?? null))
      .toEqual(["a", "b"]);
  });

  it("uses group tabs on mobile instead of exposing the split tree", () => {
    const workspace = createTerminalWorkspace(terminals, "web-2");

    expect(getMobileWorkspaceTabs(workspace)).toEqual([
      {
        id: "web-1",
        label: "Terminal web-1",
        cwd: "/home/chareice/projects/webmux",
        active: false,
      },
      {
        id: "web-2",
        label: "Terminal web-2",
        cwd: "/home/chareice/projects/webmux",
        active: true,
      },
    ]);
  });

  it("keeps a user's split layout when terminal data refreshes", () => {
    const workspace = splitWorkspacePane(
      createTerminalWorkspace([terminal("web-1", "/repo")], "web-1"),
      {
        activeTerminalId: "web-1",
        newTerminalId: "web-2",
        direction: "right",
      },
    );

    const next = reconcileTerminalWorkspace(
      workspace,
      [
        terminal("web-1", "/repo"),
        terminal("web-2", "/repo"),
        terminal("web-3", "/repo"),
      ],
      "web-2",
    );

    expect(getActiveWorkspaceGroup(next)?.root).toMatchObject({
      type: "split",
      first: {
        type: "split",
        first: { type: "leaf", terminalId: "web-1" },
        second: { type: "leaf", terminalId: "web-2" },
      },
      second: { type: "leaf", terminalId: "web-3" },
    });
    expect(
      collectPaneTerminalIds(getActiveWorkspaceGroup(next)?.root ?? null),
    ).toEqual(["web-1", "web-2", "web-3"]);
  });

  it("selects a group by activating its first pane", () => {
    const workspace = createTerminalWorkspace(terminals, "web-1");
    const next = selectWorkspaceGroup(
      workspace,
      "cwd:/home/chareice/projects/zhuyang",
    );

    expect(next.activeGroupId).toBe("cwd:/home/chareice/projects/zhuyang");
    expect(next.activeTerminalId).toBe("api-1");
  });

  it("finds adjacent panes by visual direction", () => {
    const workspace = splitWorkspacePane(
      createTerminalWorkspace([terminal("left", "/repo")], "left"),
      {
        activeTerminalId: "left",
        newTerminalId: "right",
        direction: "right",
      },
    );
    const root = getActiveWorkspaceGroup(workspace)?.root ?? null;

    expect(findAdjacentWorkspacePane(root, "right", "left")).toBe("right");
    expect(findAdjacentWorkspacePane(root, "left", "right")).toBe("left");
    expect(findAdjacentWorkspacePane(root, "up", "left")).toBeNull();
  });

  it("finds the closest pane in nested split layouts", () => {
    const base = createTerminalWorkspace(
      [terminal("left", "/repo"), terminal("top", "/repo")],
      "top",
    );
    const nested = splitWorkspacePane(base, {
      activeTerminalId: "top",
      newTerminalId: "bottom",
      direction: "down",
    });
    const root = getActiveWorkspaceGroup(nested)?.root ?? null;

    expect(findAdjacentWorkspacePane(root, "down", "top")).toBe("bottom");
    expect(findAdjacentWorkspacePane(root, "up", "bottom")).toBe("top");
    expect(findAdjacentWorkspacePane(root, "left", "bottom")).toBe("left");
  });
});

describe("strip order helpers", () => {
  it("workspacePaneOrder returns the only leaf", () => {
    expect(
      workspacePaneOrder({ type: "leaf", terminalId: "only" }),
    ).toEqual(["only"]);
  });

  it("workspacePaneOrder follows first-then-second DFS through nested splits", () => {
    const root: WorkspacePaneNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.4,
      first: {
        type: "split",
        direction: "horizontal",
        ratio: 0.3,
        first: { type: "leaf", terminalId: "top-left" },
        second: { type: "leaf", terminalId: "top-right" },
      },
      second: { type: "leaf", terminalId: "bottom" },
    };

    expect(workspacePaneOrder(root)).toEqual([
      "top-left",
      "top-right",
      "bottom",
    ]);
  });

  it("collectGroupPaneTerminalIds flattens groups in strip order", () => {
    const ws = createTerminalWorkspace(
      [
        terminal("web-1", "/home/web"),
        terminal("web-2", "/home/web"),
        terminal("api-1", "/home/api"),
      ],
      "web-1",
    );
    // cwd fallback groups sort by label: api before web.
    expect(collectGroupPaneTerminalIds(ws.groups)).toEqual([
      "api-1",
      "web-1",
      "web-2",
    ]);
  });
});

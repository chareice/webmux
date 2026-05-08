import { describe, expect, it } from "vitest";
import type { TerminalInfo } from "@webmux/shared";
import {
  closeWorkspacePane,
  collectPaneTerminalIds,
  createTerminalWorkspace,
  getActiveWorkspaceGroup,
  getMobileWorkspaceTabs,
  reconcileTerminalWorkspace,
  selectWorkspaceGroup,
  splitWorkspacePane,
} from "./terminalWorkspaceLayout";

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
});

import { describe, expect, it } from "vitest";
import type {
  MachineInfo,
  TerminalInfo,
  WorkspaceGroupInfo,
} from "@webmux/shared";
import {
  SIDEBAR_SHORTCUT_COUNT,
  buildSidebarTree,
  type SidebarTreeInput,
} from "./sidebarTree";

function machine(id: string, name: string): MachineInfo {
  return { id, name, os: "linux", home_dir: "/root" };
}

function terminal(
  id: string,
  machineId: string,
  cwd: string,
  overrides: Partial<TerminalInfo> = {},
): TerminalInfo {
  return {
    id,
    machine_id: machineId,
    title: `title-${id}`,
    cwd,
    cols: 120,
    rows: 40,
    reachable: true,
    ...overrides,
  };
}

function group(
  id: string,
  machineId: string,
  name: string,
  sortOrder: number,
): WorkspaceGroupInfo {
  return { id, machine_id: machineId, name, sort_order: sortOrder };
}

function input(overrides: Partial<SidebarTreeInput>): SidebarTreeInput {
  return {
    machines: [],
    terminals: [],
    workspaceGroups: [],
    workspaceLayouts: [],
    hostFilterId: null,
    activeMachineId: null,
    activeGroupId: null,
    activeTerminalId: null,
    ...overrides,
  };
}

describe("buildSidebarTree", () => {
  it("groups sections per machine in machine order, sections by sort_order", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas"), machine("m2", "mbp")],
        workspaceGroups: [
          group("g2", "m1", "beta", 2),
          group("g1", "m1", "alpha", 1),
          group("g3", "m2", "gamma", 1),
        ],
      }),
    );

    expect(tree.machines.map((m) => m.machineId)).toEqual(["m1", "m2"]);
    expect(tree.machines[0].sections.map((s) => s.groupId)).toEqual([
      "g1",
      "g2",
    ]);
    expect(tree.machines[1].sections.map((s) => s.groupId)).toEqual(["g3"]);
    expect(tree.machines.map((m) => m.name)).toEqual(["nas", "mbp"]);
  });

  it("keeps persistent sections before cwd fallback sections without re-sorting by status", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        workspaceGroups: [group("g1", "m1", "work", 1)],
        terminals: [
          terminal("t1", "m1", "/a", { reachable: false }),
          terminal("t2", "m1", "/b"),
        ],
      }),
    );

    const sections = tree.machines[0].sections;
    // Persistent group first, then cwd fallbacks in label order — reachable
    // state never reorders the tree.
    expect(sections.map((s) => s.groupId)).toEqual(["g1", "cwd:/a", "cwd:/b"]);
    expect(sections[1].persistent).toBe(false);
    expect(sections[1].rows[0].reachable).toBe(false);
  });

  it("builds rows from pane terminals with display titles and reachable dots", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        terminals: [
          terminal("t1", "m1", "/a", { title: "nvim" }),
          terminal("t2", "m1", "/a", { reachable: false }),
          // Legacy auto titles collapse to "shell".
          terminal("t3", "m1", "/a", { title: "Terminal deadbeef" }),
        ],
      }),
    );

    const section = tree.machines[0].sections[0];
    expect(section.groupId).toBe("cwd:/a");
    expect(section.rows).toEqual([
      { terminalId: "t1", title: "nvim", reachable: true, focused: false },
      { terminalId: "t2", title: "title-t2", reachable: false, focused: false },
      { terminalId: "t3", title: "shell", reachable: true, focused: false },
    ]);
  });

  it("assigns ⌃B N indices across machines top-to-bottom, capped at nine", () => {
    const workspaceGroups = Array.from({ length: 12 }, (_, index) =>
      group(`g${index}`, index < 6 ? "m1" : "m2", `tab ${index + 1}`, index),
    );
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas"), machine("m2", "mbp")],
        workspaceGroups,
      }),
    );

    const flat = tree.machines.flatMap((m) => m.sections);
    expect(flat.map((s) => s.shortcutIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, null, null, null,
    ]);
    expect(tree.visibleSections).toHaveLength(12);
    expect(
      tree.visibleSections.slice(0, SIDEBAR_SHORTCUT_COUNT).map((s) => s.groupId),
    ).toEqual(flat.slice(0, 9).map((s) => s.groupId));
  });

  it("dims filtered-out machines and reassigns shortcut indices to visible sections", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas"), machine("m2", "mbp")],
        workspaceGroups: [
          group("g1", "m1", "alpha", 1),
          group("g2", "m1", "beta", 2),
          group("g3", "m2", "gamma", 1),
        ],
        hostFilterId: "m2",
      }),
    );

    expect(tree.machines[0].dimmed).toBe(true);
    expect(tree.machines[1].dimmed).toBe(false);
    expect(tree.machines[0].sections.every((s) => s.dimmed)).toBe(true);
    expect(tree.machines[0].sections.every((s) => s.shortcutIndex === null))
      .toBe(true);
    expect(tree.visibleSections.map((s) => s.groupId)).toEqual(["g3"]);
    expect(tree.visibleSections[0].shortcutIndex).toBe(1);
  });

  it("marks the active section and focused row only on the active machine", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas"), machine("m2", "mbp")],
        workspaceGroups: [
          group("g1", "m1", "alpha", 1),
          group("g2", "m2", "alpha", 1),
        ],
        terminals: [
          terminal("t1", "m1", "/a", { workspace_group_id: "g1" }),
          terminal("t2", "m2", "/a", { workspace_group_id: "g2" }),
        ],
        activeMachineId: "m1",
        activeGroupId: "g1",
        activeTerminalId: "t1",
      }),
    );

    expect(tree.machines[0].sections[0].active).toBe(true);
    expect(tree.machines[0].sections[0].rows[0].focused).toBe(true);
    // Same group id shape on another machine must not light up.
    expect(tree.machines[1].sections[0].active).toBe(false);
    expect(tree.machines[1].sections[0].rows[0].focused).toBe(false);
  });

  it("treats a machine with stats or reachable terminals as online", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas"), machine("m2", "mbp")],
        terminals: [terminal("t1", "m2", "/a")],
        machineOnline: { m1: true },
      }),
    );

    expect(tree.machines[0].online).toBe(true);
    expect(tree.machines[1].online).toBe(true);

    const offline = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        terminals: [terminal("t1", "m1", "/a", { reachable: false })],
      }),
    );
    expect(offline.machines[0].online).toBe(false);
  });
});

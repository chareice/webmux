import { describe, expect, it } from "vitest";
import type {
  AgentSessionInfo,
  MachineInfo,
  TerminalInfo,
  WorkspaceGroupInfo,
} from "@offdesk/shared";
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

function agentSession(
  id: string,
  machineId: string,
  cwd: string,
  overrides: Partial<AgentSessionInfo> = {},
): AgentSessionInfo {
  return {
    id,
    machine_id: machineId,
    agent_kind: "claude",
    cwd,
    title: `agent-${id}`,
    status: "idle",
    auto_run: false,
    last_event_seq: 0,
    created_at_ms: 0,
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
    expect(sections[1].rows[0]).toMatchObject({
      kind: "terminal",
      reachable: false,
    });
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
      {
        kind: "terminal",
        terminalId: "t1",
        title: "nvim",
        reachable: true,
        focused: false,
      },
      {
        kind: "terminal",
        terminalId: "t2",
        title: "title-t2",
        reachable: false,
        focused: false,
      },
      {
        kind: "terminal",
        terminalId: "t3",
        title: "shell",
        reachable: true,
        focused: false,
      },
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
    expect(tree.machines[0].sections[0].rows[0]).toMatchObject({
      kind: "terminal",
      focused: true,
    });
    // Same group id shape on another machine must not light up.
    expect(tree.machines[1].sections[0].active).toBe(false);
    expect(tree.machines[1].sections[0].rows[0]).toMatchObject({
      kind: "terminal",
      focused: false,
    });
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

  it("places an agent session in its workspace_group_id's section, after terminal rows", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        workspaceGroups: [group("g1", "m1", "work", 1)],
        terminals: [terminal("t1", "m1", "/a", { workspace_group_id: "g1" })],
        agentSessions: [
          agentSession("s1", "m1", "/elsewhere", {
            workspace_group_id: "g1",
            agent_kind: "codex",
            status: "working",
          }),
        ],
      }),
    );

    const section = tree.machines[0].sections[0];
    expect(section.groupId).toBe("g1");
    expect(section.rows.map((row) => row.kind)).toEqual([
      "terminal",
      "agent",
    ]);
    expect(section.rows[1]).toEqual({
      kind: "agent",
      agentSessionId: "s1",
      title: "agent-s1",
      agentKind: "codex",
      status: "working",
      unread: false,
      selected: false,
    });
  });

  it("places an ungrouped agent session in the section whose cwd matches", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        workspaceGroups: [group("g1", "m1", "work", 1)],
        // g1's cwd is "/a" (derived from its terminal).
        terminals: [terminal("t1", "m1", "/a", { workspace_group_id: "g1" })],
        agentSessions: [agentSession("s1", "m1", "/a")],
      }),
    );

    const sections = tree.machines[0].sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].rows.map((row) => row.kind)).toEqual([
      "terminal",
      "agent",
    ]);
    expect(sections[0].rows[1]).toMatchObject({
      kind: "agent",
      agentSessionId: "s1",
    });
  });

  it("shares one synthetic cwd section between unmatched agent sessions", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        workspaceGroups: [group("g1", "m1", "work", 1)],
        agentSessions: [
          agentSession("s2", "m1", "/proj/app", { created_at_ms: 2 }),
          agentSession("s1", "m1", "/proj/api", { created_at_ms: 1 }),
          agentSession("s3", "m1", "/proj/app", { created_at_ms: 3 }),
        ],
      }),
    );

    const sections = tree.machines[0].sections;
    // Persistent group first, then synthetic sections in first-seen order —
    // never re-sorted by status or anything else.
    expect(sections.map((s) => s.groupId)).toEqual([
      "g1",
      "cwd:/proj/app",
      "cwd:/proj/api",
    ]);
    const synthetic = sections[1];
    expect(synthetic.label).toBe("app");
    expect(synthetic.cwd).toBe("/proj/app");
    expect(synthetic.persistent).toBe(false);
    expect(synthetic.group).toMatchObject({
      id: "cwd:/proj/app",
      workspaceGroupId: null,
      persistent: false,
      paneCount: 0,
    });
    // Same cwd → same synthetic section, rows in input order.
    expect(synthetic.rows.map((row) => row.kind)).toEqual(["agent", "agent"]);
    expect(
      synthetic.rows.map((row) => row.kind === "agent" && row.agentSessionId),
    ).toEqual(["s2", "s3"]);
  });

  it("marks agent rows unread only when unseen and not selected", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas")],
        agentSessions: [
          // No seen entry at all → unseen when last_event_seq > 0.
          agentSession("s1", "m1", "/a", { last_event_seq: 3 }),
          // seen == last_event_seq → caught up.
          agentSession("s2", "m1", "/a", { last_event_seq: 3 }),
          // Behind, but it is the open session → unread is meaningless.
          agentSession("s3", "m1", "/a", { last_event_seq: 3 }),
        ],
        agentSessionSeen: { s2: 3, s3: 1 },
        selectedAgentSessionId: "s3",
      }),
    );

    const rows = tree.machines[0].sections[0].rows;
    expect(
      rows.map((row) => row.kind === "agent" && [row.agentSessionId, row.unread, row.selected]),
    ).toEqual([
      ["s1", true, false],
      ["s2", false, false],
      ["s3", false, true],
    ]);
  });

  it("collects askedSessions oldest first across all machines, ignoring the host filter", () => {
    const tree = buildSidebarTree(
      input({
        machines: [machine("m1", "nas"), machine("m2", "mbp")],
        hostFilterId: "m1",
        agentSessions: [
          agentSession("s-working", "m1", "/a", {
            status: "working",
            created_at_ms: 1,
          }),
          // Asked on the dimmed machine — must still surface in the inbox.
          agentSession("s-asked-new", "m2", "/b", {
            status: "asked",
            agent_kind: "kimi",
            created_at_ms: 30,
          }),
          agentSession("s-asked-old", "m1", "/a", {
            status: "asked",
            created_at_ms: 10,
          }),
        ],
      }),
    );

    expect(tree.machines[1].dimmed).toBe(true);
    expect(tree.askedSessions).toEqual([
      {
        sessionId: "s-asked-old",
        machineId: "m1",
        title: "agent-s-asked-old",
        agentKind: "claude",
        createdAtMs: 10,
      },
      {
        sessionId: "s-asked-new",
        machineId: "m2",
        title: "agent-s-asked-new",
        agentKind: "kimi",
        createdAtMs: 30,
      },
    ]);
  });
});

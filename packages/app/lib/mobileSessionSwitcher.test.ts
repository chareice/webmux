import { describe, expect, it } from "vitest";
import type { AgentSessionInfo, TerminalInfo } from "@offdesk/shared";

import { buildMobileSessionGroups } from "./mobileSessionSwitcher";
import type { WorkspaceGroup } from "./terminalWorkspaceLayout";

function terminal(id: string, title: string, cwd: string): TerminalInfo {
  return {
    id,
    machine_id: "machine-1",
    title,
    cwd,
    cols: 80,
    rows: 24,
    reachable: true,
  };
}

function agentSession(
  id: string,
  cwd: string,
  overrides: Partial<AgentSessionInfo> = {},
): AgentSessionInfo {
  return {
    id,
    machine_id: "machine-1",
    agent_kind: "claude",
    cwd,
    title: `agent-${id}`,
    status: "idle",
    auto_run: true,
    workspace_group_id: null,
    last_event_seq: 3,
    created_at_ms: 1,
    ...overrides,
  };
}

function group(
  id: string,
  label: string,
  terminalIds: string[],
): WorkspaceGroup {
  const [first, ...rest] = terminalIds;
  let root: WorkspaceGroup["root"] = first
    ? { type: "leaf", terminalId: first }
    : null;
  for (const terminalId of rest) {
    root = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: root!,
      second: { type: "leaf", terminalId },
    };
  }
  return {
    id,
    label,
    cwd: `/groups/${id}`,
    workspaceGroupId: id,
    persistent: true,
    root,
    paneCount: terminalIds.length,
  };
}

describe("buildMobileSessionGroups", () => {
  it("groups panes in workspace order", () => {
    const result = buildMobileSessionGroups(
      [group("alpha", "Alpha", ["one", "two"]), group("beta", "Beta", ["three"])],
      [
        terminal("two", "Terminal Two", "/repo/two"),
        terminal("three", "Terminal Three", "/repo/three"),
        terminal("one", "Terminal One", "/repo/one"),
      ],
    );

    expect(result.map((entry) => entry.rows.length)).toEqual([2, 1]);
    expect(
      result.flatMap((entry) =>
        entry.rows.map((row) =>
          row.kind === "terminal" ? row.terminal.id : row.session.id,
        ),
      ),
    ).toEqual(["one", "two", "three"]);
  });

  it("skips stale layout leaves", () => {
    const result = buildMobileSessionGroups(
      [group("alpha", "Alpha", ["missing", "one", "two"])],
      [
        terminal("one", "Terminal One", "/repo/one"),
        terminal("two", "Terminal Two", "/repo/two"),
      ],
    );

    expect(
      result[0]?.rows.map((row) =>
        row.kind === "terminal" ? row.terminal.id : row.session.id,
      ),
    ).toEqual(["one", "two"]);
  });

  it("appends agent rows after the terminal rows of their group", () => {
    const result = buildMobileSessionGroups(
      [group("alpha", "Alpha", ["one"])],
      [terminal("one", "Terminal One", "/repo/one")],
      [agentSession("s1", "/elsewhere", { workspace_group_id: "alpha" })],
    );

    expect(result).toHaveLength(1);
    expect(result[0].rows.map((row) => row.kind)).toEqual([
      "terminal",
      "agent",
    ]);
  });

  it("places agent sessions by cwd match and creates synthetic sections", () => {
    const result = buildMobileSessionGroups(
      [group("alpha", "Alpha", ["one"])],
      [terminal("one", "Terminal One", "/repo/one")],
      [
        // cwd matches group alpha's cwd → joins that section.
        agentSession("s-cwd", "/groups/alpha"),
        // No match → synthetic cwd-fallback section, appended last.
        agentSession("s-new", "/projects/offdesk"),
      ],
    );

    expect(result.map((entry) => entry.group.id)).toEqual([
      "alpha",
      "cwd:/projects/offdesk",
    ]);
    expect(result[0].rows.map((row) => row.kind)).toEqual([
      "terminal",
      "agent",
    ]);
    const synthetic = result[1];
    expect(synthetic.group.label).toBe("offdesk");
    expect(synthetic.group.persistent).toBe(false);
    expect(synthetic.rows).toHaveLength(1);
    expect(synthetic.rows[0].kind).toBe("agent");
  });

  it("keeps agent sessions in first-seen order; strip order is groups then rows", () => {
    const result = buildMobileSessionGroups(
      [group("alpha", "Alpha", ["one"])],
      [terminal("one", "Terminal One", "/repo/one")],
      [
        agentSession("s-b", "/b"),
        agentSession("s-a1", "/a"),
        agentSession("s-a2", "/a"),
      ],
    );

    // Strip order: group alpha's terminal, then synthetic sections in
    // first-seen order (/b before /a), agents within a section in input order.
    expect(
      result.flatMap((entry) =>
        entry.rows.map((row) =>
          row.kind === "terminal" ? row.terminal.id : row.session.id,
        ),
      ),
    ).toEqual(["one", "s-b", "s-a1", "s-a2"]);
  });

  it("marks agent rows unread from the seen map, except the selected one", () => {
    const result = buildMobileSessionGroups(
      [],
      [],
      [
        agentSession("s1", "/a", { last_event_seq: 5 }),
        agentSession("s2", "/a", { last_event_seq: 5 }),
        agentSession("s3", "/a", { last_event_seq: 2 }),
      ],
      { s1: 4, s2: 5, s3: 0 },
      "s1",
    );

    const rows = result[0].rows;
    expect(
      rows.map((row) => row.kind === "agent" && [row.session.id, row.unread, row.selected]),
    ).toEqual([
      ["s1", false, true],
      ["s2", false, false],
      ["s3", true, false],
    ]);
  });

  it("drops groups with no rows but keeps agent-only groups", () => {
    const result = buildMobileSessionGroups(
      [group("alpha", "Alpha", []), group("beta", "Beta", ["one"])],
      [terminal("one", "Terminal One", "/repo/one")],
      [agentSession("s1", "/elsewhere", { workspace_group_id: "alpha" })],
    );

    expect(result.map((entry) => entry.group.id)).toEqual(["alpha", "beta"]);
  });
});

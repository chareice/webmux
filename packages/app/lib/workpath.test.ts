import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveWorkpaths } from "./workpath.ts";
import type { Run, AgentInfo } from "@webmux/shared";

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: "r1",
    agentId: "a1",
    tool: "claude",
    repoPath: "/home/user/project",
    branch: "main",
    prompt: "fix bug",
    status: "success",
    createdAt: 1000,
    updatedAt: 2000,
    hasDiff: false,
    unread: false,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    id: "a1",
    name: "my-nas",
    status: "online",
    lastSeenAt: null,
    ...overrides,
  };
}

describe("deriveWorkpaths", () => {
  it("groups runs by repoPath", () => {
    const runs = [
      makeRun({ id: "r1", repoPath: "/home/user/project-a", updatedAt: 100 }),
      makeRun({ id: "r2", repoPath: "/home/user/project-b", updatedAt: 200 }),
      makeRun({ id: "r3", repoPath: "/home/user/project-a", updatedAt: 300 }),
    ];
    const agents = new Map([["a1", makeAgent({})]]);
    const result = deriveWorkpaths(runs, agents);
    assert.equal(result.length, 2);
    assert.equal(result[0].repoPath, "/home/user/project-a");
    assert.equal(result[0].runs.length, 2);
    assert.equal(result[1].repoPath, "/home/user/project-b");
  });

  it("sorts by active first, then most recent", () => {
    const runs = [
      makeRun({ id: "r1", repoPath: "/path/old", updatedAt: 100, status: "success" }),
      makeRun({ id: "r2", repoPath: "/path/active", updatedAt: 50, status: "running" }),
    ];
    const agents = new Map([["a1", makeAgent({})]]);
    const result = deriveWorkpaths(runs, agents);
    assert.equal(result[0].repoPath, "/path/active");
    assert.equal(result[0].hasActive, true);
  });

  it("extracts directory name from path", () => {
    const runs = [makeRun({ repoPath: "/home/user/my-cool-project" })];
    const agents = new Map([["a1", makeAgent({})]]);
    const result = deriveWorkpaths(runs, agents);
    assert.equal(result[0].dirName, "my-cool-project");
  });

  it("includes node name from agents map", () => {
    const runs = [makeRun({ agentId: "a1" })];
    const agents = new Map([["a1", makeAgent({ id: "a1", name: "my-nas" })]]);
    const result = deriveWorkpaths(runs, agents);
    assert.equal(result[0].nodeName, "my-nas");
  });

  it("counts active threads", () => {
    const runs = [
      makeRun({ id: "r1", status: "running" }),
      makeRun({ id: "r2", status: "success" }),
      makeRun({ id: "r3", status: "starting" }),
    ];
    const agents = new Map([["a1", makeAgent({})]]);
    const result = deriveWorkpaths(runs, agents);
    assert.equal(result[0].activeCount, 2);
  });

  it("counts unread threads", () => {
    const runs = [
      makeRun({ id: "r1", unread: true }),
      makeRun({ id: "r2", unread: false }),
      makeRun({ id: "r3", unread: true }),
    ];
    const agents = new Map([["a1", makeAgent({})]]);
    const result = deriveWorkpaths(runs, agents);
    assert.equal(result[0].unreadCount, 2);
  });

  it("returns empty array for no runs", () => {
    const result = deriveWorkpaths([], new Map());
    assert.deepEqual(result, []);
  });
});

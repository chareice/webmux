import test from "node:test";
import assert from "node:assert/strict";

import {
  getLiveTerminalIds,
  getTerminalSurfaceMode,
} from "./terminalSessionPolicy.ts";

test("terminal grid keeps cards in preview mode until one is maximized", () => {
  const terminals = [
    { id: "term-a" },
    { id: "term-b" },
  ];

  assert.deepEqual(getLiveTerminalIds(terminals, null), []);
  assert.equal(getTerminalSurfaceMode("term-a", null), "preview");
  assert.equal(getTerminalSurfaceMode("term-b", null), "preview");
});

test("only the maximized terminal stays live", () => {
  const terminals = [
    { id: "term-a" },
    { id: "term-b" },
    { id: "term-c" },
  ];

  assert.deepEqual(getLiveTerminalIds(terminals, "term-b"), ["term-b"]);
  assert.equal(getTerminalSurfaceMode("term-b", "term-b"), "live");
  assert.equal(getTerminalSurfaceMode("term-a", "term-b"), "preview");
});

test("unknown maximized ids do not mount any live terminal", () => {
  const terminals = [{ id: "term-a" }];

  assert.deepEqual(getLiveTerminalIds(terminals, "missing"), []);
});

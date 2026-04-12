import test from "node:test";
import assert from "node:assert/strict";

import {
  getLiveTerminalIds,
  getTerminalSurfaceMode,
} from "./terminalSessionPolicy.ts";

test("terminal grid keeps every card live by default", () => {
  const terminals = [
    { id: "term-a" },
    { id: "term-b" },
  ];

  assert.deepEqual(getLiveTerminalIds(terminals, null), ["term-a", "term-b"]);
  assert.equal(getTerminalSurfaceMode("term-a", null), "live");
  assert.equal(getTerminalSurfaceMode("term-b", null), "live");
});

test("maximizing a terminal no longer hides live terminals in the grid", () => {
  const terminals = [
    { id: "term-a" },
    { id: "term-b" },
    { id: "term-c" },
  ];

  assert.deepEqual(getLiveTerminalIds(terminals, "term-b"), [
    "term-a",
    "term-b",
    "term-c",
  ]);
  assert.equal(getTerminalSurfaceMode("term-b", "term-b"), "live");
  assert.equal(getTerminalSurfaceMode("term-a", "term-b"), "live");
});

test("unknown maximized ids still keep every visible terminal live", () => {
  const terminals = [{ id: "term-a" }];

  assert.deepEqual(getLiveTerminalIds(terminals, "missing"), ["term-a"]);
});

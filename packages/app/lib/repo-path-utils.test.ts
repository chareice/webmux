import test from "node:test";
import assert from "node:assert/strict";

import {
  getRepoNameFromPath,
  resolveProjectNameFromRepoPath,
} from "./repo-path-utils.ts";

test("getRepoNameFromPath trims the input before deriving the repo name", () => {
  assert.equal(
    getRepoNameFromPath("  /home/chareice/projects/webmux  "),
    "webmux",
  );
});

test("resolveProjectNameFromRepoPath auto-fills the project name when empty", () => {
  assert.equal(
    resolveProjectNameFromRepoPath("", "/home/chareice/projects/webmux"),
    "webmux",
  );
});

test("resolveProjectNameFromRepoPath preserves an existing project name", () => {
  assert.equal(
    resolveProjectNameFromRepoPath(
      "Personal fork",
      "/home/chareice/projects/webmux",
    ),
    "Personal fork",
  );
});

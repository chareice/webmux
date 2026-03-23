import test from "node:test";
import assert from "node:assert/strict";

import { compareVersions, getUpdateState } from "./update-utils.ts";

test("compareVersions compares semantic versions numerically", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("1.3.0", "1.2.9"), 1);
});

test("getUpdateState reports when an update is available", () => {
  assert.deepEqual(getUpdateState("1.0.0", "1.1.0"), {
    latestVersion: "1.1.0",
    status: "available",
  });
});

test("getUpdateState reports when the current version is already up to date", () => {
  assert.deepEqual(getUpdateState("1.1.0", "1.1.0"), {
    latestVersion: "1.1.0",
    status: "current",
  });
});

test("getUpdateState handles missing version info", () => {
  assert.deepEqual(getUpdateState("1.1.0", null), {
    latestVersion: null,
    status: "unavailable",
  });
});

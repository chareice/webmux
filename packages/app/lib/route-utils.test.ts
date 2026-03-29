import test from "node:test";
import assert from "node:assert/strict";

import {
  getSettingsRoute,
  getThreadsRoute,
} from "./route-utils.ts";

test("getThreadsRoute points to the threads tab", () => {
  assert.equal(getThreadsRoute(), "/(main)/(tabs)/threads");
});

test("getSettingsRoute points to the settings tab", () => {
  assert.equal(getSettingsRoute(), "/(main)/(tabs)/settings");
});


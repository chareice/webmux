import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectRoute,
  getProjectsRoute,
  getSettingsRoute,
  getThreadsRoute,
} from "./route-utils.ts";

test("getThreadsRoute points to the threads tab", () => {
  assert.equal(getThreadsRoute(), "/(main)/(tabs)/threads");
});

test("getProjectsRoute points to the projects tab", () => {
  assert.equal(getProjectsRoute(), "/(main)/(tabs)/projects");
});

test("getSettingsRoute points to the settings tab", () => {
  assert.equal(getSettingsRoute(), "/(main)/(tabs)/settings");
});

test("buildProjectRoute encodes the project id", () => {
  assert.equal(
    buildProjectRoute("project/with spaces"),
    "/(main)/projects/project%2Fwith%20spaces",
  );
});

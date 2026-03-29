import test from "node:test";
import assert from "node:assert/strict";

import { getSettingsRoute } from "./route-utils.ts";

test("getSettingsRoute points to the settings page", () => {
  assert.equal(getSettingsRoute(), "/(main)/settings");
});

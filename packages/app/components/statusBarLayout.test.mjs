import test from "node:test";
import assert from "node:assert/strict";

import { getStatusBarLayout } from "./statusBarLayout.ts";

test("mobile status bar prioritizes control actions over telemetry", () => {
  const layout = getStatusBarLayout(true);

  assert.equal(layout.showStats, true);
  assert.equal(layout.showModeLabel, false);
  assert.equal(layout.actionButtonPadding, "1px 5px");
  assert.deepEqual(layout.visibleStats, ["cpu", "memory"]);
});

test("desktop status bar keeps telemetry visible", () => {
  const layout = getStatusBarLayout(false);

  assert.equal(layout.showStats, true);
  assert.equal(layout.showModeLabel, true);
  assert.equal(layout.actionButtonPadding, "1px 6px");
  assert.deepEqual(layout.visibleStats, ["cpu", "memory", "disk"]);
});

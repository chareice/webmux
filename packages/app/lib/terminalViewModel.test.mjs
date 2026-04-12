import test from "node:test";
import assert from "node:assert/strict";

import {
  getTerminalControlCopy,
  getTerminalFitDimensions,
  getTerminalViewportLayout,
} from "./terminalViewModel.ts";

test("view-only sessions use simplified control copy", () => {
  assert.deepEqual(getTerminalControlCopy(false), {
    modeLabel: "Viewing",
    toggleLabel: "Control Here",
    sizeActionLabel: "Use This Size",
  });
});

test("controlled sessions use simplified control copy", () => {
  assert.deepEqual(getTerminalControlCopy(true), {
    modeLabel: "Controlling",
    toggleLabel: "Stop Control",
    sizeActionLabel: "Use This Size",
  });
});

test("immersive view shrinks wide terminals to the available width", () => {
  const layout = getTerminalViewportLayout({
    displayMode: "immersive",
    viewportWidth: 390,
    viewportHeight: 844,
    contentWidth: 1180,
    contentHeight: 720,
  });

  assert.equal(layout.scale, 390 / 1180);
  assert.equal(layout.frameWidth, 390);
  assert.equal(layout.frameHeight, 720 * (390 / 1180));
  assert.equal(layout.justifyContent, "center");
});

test("immersive view keeps narrow terminals at native size and centers them", () => {
  const layout = getTerminalViewportLayout({
    displayMode: "immersive",
    viewportWidth: 1280,
    viewportHeight: 900,
    contentWidth: 520,
    contentHeight: 410,
  });

  assert.equal(layout.scale, 1);
  assert.equal(layout.frameWidth, 520);
  assert.equal(layout.frameHeight, 410);
  assert.equal(layout.justifyContent, "center");
});

test("card view skips immersive scaling rules", () => {
  const layout = getTerminalViewportLayout({
    displayMode: "card",
    viewportWidth: 390,
    viewportHeight: 844,
    contentWidth: 1180,
    contentHeight: 720,
  });

  assert.equal(layout.scale, 1);
  assert.equal(layout.frameWidth, 1180);
  assert.equal(layout.frameHeight, 720);
  assert.equal(layout.justifyContent, "flex-start");
});

test("fit dimensions are derived from the local viewport instead of the scaled session width", () => {
  assert.deepEqual(
    getTerminalFitDimensions({
      viewportWidth: 370,
      viewportHeight: 420,
      contentWidth: 667,
      contentHeight: 384,
      cols: 80,
      rows: 24,
    }),
    {
      cols: 44,
      rows: 26,
    },
  );
});

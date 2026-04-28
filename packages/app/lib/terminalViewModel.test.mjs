import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateInitialTerminalDimensions,
  estimateMobileInitialTerminalDimensions,
  getTerminalControlCopy,
  getTerminalFitDimensions,
  getTerminalViewportLayout,
} from "./terminalViewModel.ts";

test("view-only sessions use simplified control copy", () => {
  assert.deepEqual(getTerminalControlCopy(false), {
    modeLabel: "Viewing",
    toggleLabel: "Control Here",
    sizeActionLabel: "Fit to Window",
  });
});

test("controlled sessions use simplified control copy", () => {
  assert.deepEqual(getTerminalControlCopy(true), {
    modeLabel: "Controlling",
    toggleLabel: "Stop Control",
    sizeActionLabel: "Fit to Window",
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

test("estimateInitialTerminalDimensions produces a reasonable desktop default", () => {
  // 1440×900 desktop → comfortably more than 80×24
  const { cols, rows } = estimateInitialTerminalDimensions(1440, 900);
  assert.ok(cols > 80, `expected cols > 80, got ${cols}`);
  assert.ok(rows > 24, `expected rows > 24, got ${rows}`);
});

test("estimateInitialTerminalDimensions enforces the 80×24 lower bound", () => {
  // Tiny / zero input still returns a sensible minimum so the server
  // never sees cols=0/rows=0 in the POST body.
  assert.deepEqual(estimateInitialTerminalDimensions(0, 0), {
    cols: 80,
    rows: 24,
  });
  assert.deepEqual(estimateInitialTerminalDimensions(100, 100), {
    cols: 80,
    rows: 24,
  });
});

test("estimateInitialTerminalDimensions clamps at 400×200 to block runaway values", () => {
  const { cols, rows } = estimateInitialTerminalDimensions(10_000, 10_000);
  assert.equal(cols, 400);
  assert.equal(rows, 200);
});

test("estimateMobileInitialTerminalDimensions accounts for mobile overlay chrome", () => {
  const { cols, rows } = estimateMobileInitialTerminalDimensions(390, 664);
  assert.deepEqual({ cols, rows }, { cols: 52, rows: 27 });
});

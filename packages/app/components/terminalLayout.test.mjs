import test from "node:test";
import assert from "node:assert/strict";

import {
  MOBILE_STATUS_BAR_HEIGHT,
  getMaximizedTerminalFrame,
} from "./terminalLayout.ts";

test("mobile maximized terminal leaves room for the status bar", () => {
  assert.deepEqual(getMaximizedTerminalFrame(true), {
    top: 0,
    left: 0,
    width: "100vw",
    height: `calc(100dvh - ${MOBILE_STATUS_BAR_HEIGHT}px)`,
  });
});

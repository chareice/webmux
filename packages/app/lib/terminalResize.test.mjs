import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResizeMessage,
  didGainControl,
} from "./terminalResize.ts";

test("buildResizeMessage rejects non-finite terminal dimensions", () => {
  assert.equal(buildResizeMessage({ cols: Number.NaN, rows: Number.NaN }), null);
  assert.equal(buildResizeMessage({ cols: 80, rows: Number.POSITIVE_INFINITY }), null);
  assert.equal(buildResizeMessage({ cols: 0, rows: 24 }), null);
  assert.equal(buildResizeMessage({ cols: 80, rows: 0 }), null);
});

test("buildResizeMessage normalizes finite terminal dimensions", () => {
  assert.deepEqual(buildResizeMessage({ cols: 120.8, rows: 36.4 }), {
    type: "resize",
    cols: 120,
    rows: 36,
  });
});

test("didGainControl only reports watch-to-control transitions", () => {
  assert.equal(didGainControl(false, true), true);
  assert.equal(didGainControl(true, true), false);
  assert.equal(didGainControl(true, false), false);
  assert.equal(didGainControl(false, false), false);
});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const loadAppConfig = require("../app.config.js");

test("app config keeps Android thread inputs visible above the keyboard", () => {
  const config = loadAppConfig({ config: {} });

  assert.equal(config.android?.softwareKeyboardLayoutMode, "pan");
});

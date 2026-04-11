import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTALL_SCRIPT_URL,
  getInstallCommand,
} from "./nodeInstaller.ts";

test("getInstallCommand uses the shared install script", () => {
  assert.equal(
    INSTALL_SCRIPT_URL,
    "https://raw.githubusercontent.com/chareice/webmux/main/scripts/install.sh",
  );
  assert.equal(getInstallCommand(), `curl -sSL ${INSTALL_SCRIPT_URL} | sh`);
  assert.doesNotMatch(getInstallCommand(), /webmux-node-(linux|darwin)-(x64|arm64)/);
});

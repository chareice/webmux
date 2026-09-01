import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTALL_SCRIPT_URL,
  getInstallCommand,
} from "./nodeInstaller.ts";

test("getInstallCommand uses the installer the site serves", () => {
  assert.equal(INSTALL_SCRIPT_URL, "https://offdesk.dev/install");
  assert.equal(
    getInstallCommand(),
    "curl -fsSL https://offdesk.dev/install | sh -s -- --node-only",
  );
});

test("onboarding asks for the machine agent alone, not the CLI", () => {
  // The onboarding flow registers a machine. Installing the CLI as a side
  // effect would put a second, unconfigured tool on the box.
  assert.match(getInstallCommand(), /--node-only/);
  assert.doesNotMatch(getInstallCommand(), /offdesk-node-(linux|darwin)-(x64|arm64)/);
});

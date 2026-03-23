import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  resolveAndroidBuildConfig,
  resolveGoogleServicesFile,
} = require("./app-config-utils.js");

test("resolveAndroidBuildConfig uses release env values when present", () => {
  assert.deepEqual(
    resolveAndroidBuildConfig({
      WEBMUX_MOBILE_VERSION_CODE: "12003",
      WEBMUX_MOBILE_VERSION_NAME: "1.2.3",
    }),
    {
      version: "1.2.3",
      versionCode: 12003,
    },
  );
});

test("resolveAndroidBuildConfig falls back when release env is invalid", () => {
  assert.deepEqual(
    resolveAndroidBuildConfig({
      WEBMUX_MOBILE_VERSION_CODE: "not-a-number",
      WEBMUX_MOBILE_VERSION_NAME: "",
    }),
    {
      version: "1.0.0",
      versionCode: 1,
    },
  );
});

test("resolveGoogleServicesFile returns explicit relative paths from env", () => {
  const appRoot = "/tmp/webmux-app";

  assert.equal(
    resolveGoogleServicesFile(appRoot, {
      WEBMUX_ANDROID_GOOGLE_SERVICES_PATH: "./config/google-services.json",
    }),
    path.resolve(appRoot, "./config/google-services.json"),
  );
});

test("resolveGoogleServicesFile uses bundled google-services.json when present", async () => {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "webmux-app-config-"),
  );
  const bundledPath = path.join(tempRoot, "google-services.json");

  await fs.promises.writeFile(bundledPath, "{}\n", "utf8");

  try {
    assert.equal(
      resolveGoogleServicesFile(tempRoot, {}),
      bundledPath,
    );
  } finally {
    await fs.promises.rm(tempRoot, { force: true, recursive: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegistrationCommand,
  getRegistrationServerUrl,
} from "./registration-utils.ts";

test("getRegistrationServerUrl prefers the explicit server URL from the backend", () => {
  assert.equal(
    getRegistrationServerUrl({
      serverUrl: "https://webmux.nas.chareice.site/",
      windowOrigin: "http://127.0.0.1:4001",
    }),
    "https://webmux.nas.chareice.site",
  );
});

test("getRegistrationServerUrl falls back to the current origin when no server URL is provided", () => {
  assert.equal(
    getRegistrationServerUrl({
      windowOrigin: "http://127.0.0.1:4001",
    }),
    "http://127.0.0.1:4001",
  );
});

test("getRegistrationServerUrl falls back to the last known server URL before the local origin", () => {
  assert.equal(
    getRegistrationServerUrl({
      lastServerUrl: "https://webmux.nas.chareice.site/",
      windowOrigin: "http://127.0.0.1:4001",
    }),
    "https://webmux.nas.chareice.site",
  );
});

test("buildRegistrationCommand uses the resolved server URL", () => {
  assert.equal(
    buildRegistrationCommand({
      token: "token-123",
      serverUrl: "https://webmux.nas.chareice.site",
      windowOrigin: "http://127.0.0.1:4001",
    }),
    "npx @webmux/agent register --server https://webmux.nas.chareice.site --token token-123",
  );
});

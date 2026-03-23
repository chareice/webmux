import test from "node:test";
import assert from "node:assert/strict";

import { getStorageKeyForPlatform } from "./storage-utils.ts";

test("getStorageKeyForPlatform keeps web keys unchanged", () => {
  assert.equal(
    getStorageKeyForPlatform("webmux:last_server_url", "web"),
    "webmux:last_server_url",
  );
});

test("getStorageKeyForPlatform sanitizes native keys for SecureStore", () => {
  assert.equal(
    getStorageKeyForPlatform("webmux:last_server_url", "android"),
    "webmux_last_server_url",
  );
});

test("getStorageKeyForPlatform preserves SecureStore-safe native keys", () => {
  assert.equal(
    getStorageKeyForPlatform("webmux.last-server_url", "android"),
    "webmux.last-server_url",
  );
});

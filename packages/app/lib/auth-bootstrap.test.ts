import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthBootstrapState } from "./auth-bootstrap.ts";

test("resolveAuthBootstrapState returns a callback session before stored state", async () => {
  const result = await resolveAuthBootstrapState({
    currentUrl: null,
    devLogin: async () => null,
    getInitialUrl: async () =>
      "webmux://auth?token=abc&server=https%3A%2F%2Fexample.com",
    platformOs: "android",
    readServerUrl: async () => "https://stored.example.com",
    readToken: async () => "stored-token",
  });

  assert.deepEqual(result, {
    serverUrl: "https://example.com",
    source: "callback",
    token: "abc",
  });
});

test("resolveAuthBootstrapState falls back to stored auth when no callback is present", async () => {
  const result = await resolveAuthBootstrapState({
    currentUrl: null,
    devLogin: async () => null,
    getInitialUrl: async () => null,
    platformOs: "android",
    readServerUrl: async () => "https://stored.example.com",
    readToken: async () => "stored-token",
  });

  assert.deepEqual(result, {
    serverUrl: "https://stored.example.com",
    source: "storage",
    token: "stored-token",
  });
});

test("resolveAuthBootstrapState falls back to dev login on web", async () => {
  const result = await resolveAuthBootstrapState({
    currentUrl: null,
    devLogin: async () => ({ token: "dev-token" }),
    getInitialUrl: async () => null,
    platformOs: "web",
    readServerUrl: async () => null,
    readToken: async () => null,
  });

  assert.deepEqual(result, {
    serverUrl: "",
    source: "dev",
    token: "dev-token",
  });
});

test("resolveAuthBootstrapState returns none when initial URL lookup hangs", async () => {
  const result = await resolveAuthBootstrapState({
    currentUrl: null,
    devLogin: async () => null,
    getInitialUrl: async () => new Promise(() => {}),
    platformOs: "android",
    readServerUrl: async () => {
      throw new Error("should not run");
    },
    readToken: async () => {
      throw new Error("should not run");
    },
    timeoutMs: 20,
  });

  assert.deepEqual(result, {
    serverUrl: "",
    source: "none",
    token: null,
  });
});

test("resolveAuthBootstrapState returns none when storage access throws", async () => {
  const result = await resolveAuthBootstrapState({
    currentUrl: null,
    devLogin: async () => null,
    getInitialUrl: async () => null,
    platformOs: "android",
    readServerUrl: async () => null,
    readToken: async () => {
      throw new Error("secure store failed");
    },
  });

  assert.deepEqual(result, {
    serverUrl: "",
    source: "none",
    token: null,
  });
});

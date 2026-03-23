import test from "node:test";
import assert from "node:assert/strict";

import {
  extractAuthCallback,
  normalizeServerUrl,
  OAUTH_PROVIDERS,
} from "./auth-utils.ts";

test("normalizeServerUrl trims whitespace, adds https, and removes trailing slashes", () => {
  assert.equal(normalizeServerUrl(""), "");
  assert.equal(
    normalizeServerUrl("webmux.nas.chareice.site/"),
    "https://webmux.nas.chareice.site",
  );
  assert.equal(
    normalizeServerUrl(" https://webmux.nas.chareice.site/// "),
    "https://webmux.nas.chareice.site",
  );
  assert.equal(
    normalizeServerUrl("http://localhost:8787/"),
    "http://localhost:8787",
  );
});

test("extractAuthCallback parses native OAuth redirects", () => {
  assert.deepEqual(
    extractAuthCallback(
      "webmux://auth?token=token-123&server=https%3A%2F%2Fwebmux.example.com%2F&provider=google",
    ),
    {
      provider: "google",
      serverUrl: "https://webmux.example.com",
      token: "token-123",
    },
  );
});

test("extractAuthCallback parses web OAuth redirects", () => {
  assert.deepEqual(
    extractAuthCallback("https://webmux.example.com/login?token=token-123"),
    {
      provider: null,
      serverUrl: "",
      token: "token-123",
    },
  );
});

test("extractAuthCallback rejects callback URLs without a token", () => {
  assert.equal(extractAuthCallback("webmux://auth?provider=github"), null);
});

test("OAUTH_PROVIDERS keeps both supported providers available", () => {
  assert.deepEqual(
    OAUTH_PROVIDERS.map((provider) => provider.value),
    ["github", "google"],
  );
});

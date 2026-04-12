import test from "node:test";
import assert from "node:assert/strict";

import {
  getTokenActionLabel,
  shouldGenerateRegistrationToken,
} from "./onboardingFlow.ts";

test("token generation stays idle until the user asks for it", () => {
  assert.equal(
    shouldGenerateRegistrationToken({
      requested: false,
      token: null,
      expiresAt: null,
      now: 1_700_000_000_000,
    }),
    false,
  );
});

test("token generation runs on explicit request and refreshes expired tokens", () => {
  const now = 1_700_000_000_000;

  assert.equal(
    shouldGenerateRegistrationToken({
      requested: true,
      token: null,
      expiresAt: null,
      now,
    }),
    true,
  );

  assert.equal(
    shouldGenerateRegistrationToken({
      requested: true,
      token: "cached",
      expiresAt: now + 120_000,
      now,
    }),
    false,
  );

  assert.equal(
    shouldGenerateRegistrationToken({
      requested: true,
      token: "expired",
      expiresAt: now + 10_000,
      now,
    }),
    true,
  );
});

test("token action label reflects explicit onboarding states", () => {
  assert.equal(getTokenActionLabel({ loading: false, token: null }), "Generate Token");
  assert.equal(getTokenActionLabel({ loading: true, token: null }), "Generating…");
  assert.equal(getTokenActionLabel({ loading: false, token: "token-123" }), "Regenerate Token");
});

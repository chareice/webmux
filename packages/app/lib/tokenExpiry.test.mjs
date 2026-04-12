import test from "node:test";
import assert from "node:assert/strict";

import { isRegistrationTokenFresh } from "./tokenExpiry.ts";

test("registration token uses millisecond expiry timestamps", () => {
  const now = 1_700_000_000_000;

  assert.equal(
    isRegistrationTokenFresh(now + 120_000, now),
    true,
  );
  assert.equal(
    isRegistrationTokenFresh(now + 30_000, now),
    false,
  );
});

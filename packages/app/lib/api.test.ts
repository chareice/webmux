import test from "node:test";
import assert from "node:assert/strict";

import { resolveRegistrationTokenResponse } from "./registration-utils.ts";

test("resolveRegistrationTokenResponse reads the server URL from the proxy header when the backend omits it", () => {
  const response = resolveRegistrationTokenResponse(
    {
      token: "registration-token",
      expiresAt: Date.now() + 60_000,
    },
    "https://webmux.nas.chareice.site/",
  );

  assert.equal(response.serverUrl, "https://webmux.nas.chareice.site/");
});

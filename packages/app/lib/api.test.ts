import test from "node:test";
import assert from "node:assert/strict";

import { buildImportableSessionsPath } from "./importable-sessions-api.ts";
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

test("buildImportableSessionsPath targets the filtered session list endpoint", () => {
  assert.equal(
    buildImportableSessionsPath("agent-1", "codex", "/repo path"),
    "/api/agents/agent-1/importable-sessions?tool=codex&repoPath=%2Frepo+path",
  );
});

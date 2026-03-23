import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInstructionsPath,
  buildSaveInstructionsBody,
} from "./instructions-api.ts";

test("buildInstructionsPath targets the instructions endpoint with a tool query", () => {
  assert.equal(
    buildInstructionsPath("agent-123", "claude"),
    "/api/agents/agent-123/instructions?tool=claude",
  );
});

test("buildSaveInstructionsBody includes both tool and content", () => {
  assert.equal(
    buildSaveInstructionsBody("codex", "Follow AGENTS.md"),
    JSON.stringify({
      tool: "codex",
      content: "Follow AGENTS.md",
    }),
  );
});

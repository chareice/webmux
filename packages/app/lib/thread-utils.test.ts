import test from "node:test";
import assert from "node:assert/strict";

import type { RunTurnDetail } from "@webmux/shared";

import { canContinueTurn, canRetryTurn } from "./thread-utils.ts";

function makeTurn(
  overrides: Partial<RunTurnDetail>,
): RunTurnDetail {
  return {
    attachments: [],
    createdAt: 1,
    id: "turn-1",
    items: [],
    prompt: "hello",
    status: "success",
    updatedAt: 1,
    ...overrides,
  };
}

test("canContinueTurn matches the statuses allowed by the unified composer", () => {
  assert.equal(canContinueTurn(makeTurn({ status: "success" })), true);
  assert.equal(canContinueTurn(makeTurn({ status: "failed" })), true);
  assert.equal(canContinueTurn(makeTurn({ status: "interrupted" })), true);
  assert.equal(canContinueTurn(makeTurn({ status: "queued" })), false);
});

test("canRetryTurn allows failed and interrupted turns with a prompt", () => {
  assert.equal(canRetryTurn(makeTurn({ status: "failed" }), 0), true);
  assert.equal(canRetryTurn(makeTurn({ status: "interrupted" }), 0), true);
});

test("canRetryTurn rejects turns that are blocked by queue state or missing prompt", () => {
  assert.equal(canRetryTurn(makeTurn({ status: "interrupted" }), 2), false);
  assert.equal(canRetryTurn(makeTurn({ status: "failed", prompt: "" }), 0), false);
  assert.equal(canRetryTurn(makeTurn({ status: "success" }), 0), false);
});

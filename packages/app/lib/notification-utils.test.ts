import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadRoute,
  parseThreadNotificationTarget,
} from "./notification-utils.ts";

test("parseThreadNotificationTarget accepts runId payloads", () => {
  assert.deepEqual(
    parseThreadNotificationTarget({
      agentId: "agent-1",
      runId: "run-1",
    }),
    {
      agentId: "agent-1",
      threadId: "run-1",
    },
  );
});

test("parseThreadNotificationTarget accepts threadId payloads", () => {
  assert.deepEqual(
    parseThreadNotificationTarget({
      agentId: "agent-1",
      threadId: "thread-1",
    }),
    {
      agentId: "agent-1",
      threadId: "thread-1",
    },
  );
});

test("parseThreadNotificationTarget rejects malformed payloads", () => {
  assert.equal(parseThreadNotificationTarget(null), null);
  assert.equal(parseThreadNotificationTarget({}), null);
  assert.equal(parseThreadNotificationTarget({ agentId: "agent-1" }), null);
  assert.equal(parseThreadNotificationTarget({ threadId: "thread-1" }), null);
});

test("buildThreadRoute returns the unified thread route", () => {
  assert.equal(
    buildThreadRoute({
      agentId: "agent-1",
      threadId: "thread-1",
    }),
    "/(main)/threads/agent-1/thread-1",
  );
});

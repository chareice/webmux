import test from "node:test";
import assert from "node:assert/strict";

import { TimeoutError, withTimeout } from "./async-utils.ts";

test("withTimeout resolves when the task finishes in time", async () => {
  const value = await withTimeout(Promise.resolve("ok"), 50);

  assert.equal(value, "ok");
});

test("withTimeout rejects with TimeoutError when the task hangs", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 20),
    TimeoutError,
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import { createOrderedBinaryOutputQueue } from "./orderedBinaryOutput.mjs";

test("ordered binary output queue preserves receive order across async blobs", async () => {
  const seen = [];
  const queue = createOrderedBinaryOutputQueue((chunk) => {
    seen.push(Buffer.from(chunk).toString("utf8"));
  });

  const slowBlobLike = {
    async arrayBuffer() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new TextEncoder().encode("first").buffer;
    },
  };

  queue.push(slowBlobLike);
  queue.push(new TextEncoder().encode("second").buffer);

  await queue.flush();

  assert.deepEqual(seen, ["first", "second"]);
});

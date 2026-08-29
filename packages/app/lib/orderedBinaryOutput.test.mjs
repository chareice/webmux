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

test("array buffers with nothing queued are delivered synchronously", () => {
  const seen = [];
  const queue = createOrderedBinaryOutputQueue((chunk) => {
    seen.push(Buffer.from(chunk).toString("utf8"));
  });

  queue.push(new TextEncoder().encode("a").buffer);
  queue.push(new TextEncoder().encode("b").buffer);

  // No await: the fast path must not defer to a microtask.
  assert.deepEqual(seen, ["a", "b"]);
});

test("fast path resumes after the async chain drains", async () => {
  const seen = [];
  const queue = createOrderedBinaryOutputQueue((chunk) => {
    seen.push(Buffer.from(chunk).toString("utf8"));
  });

  queue.push({
    async arrayBuffer() {
      return new TextEncoder().encode("blob").buffer;
    },
  });
  queue.push(new TextEncoder().encode("queued").buffer);
  await queue.flush();
  // Let the trailing .finally() microtasks run so pending returns to zero.
  await Promise.resolve();

  queue.push(new TextEncoder().encode("sync").buffer);
  assert.deepEqual(seen, ["blob", "queued", "sync"]);
});

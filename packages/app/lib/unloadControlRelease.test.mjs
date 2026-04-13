import test from "node:test";
import assert from "node:assert/strict";

import {
  storePendingControlRelease,
  takePendingControlRelease,
} from "./unloadControlRelease.ts";

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test("stored control releases can be consumed once on the next load", () => {
  const storage = createStorage();

  storePendingControlRelease(storage, ["machine-a", "machine-b"]);

  assert.deepEqual(takePendingControlRelease(storage), ["machine-a", "machine-b"]);
  assert.equal(
    storage.getItem("tc-release-control-on-next-load"),
    null,
  );
});

test("empty control releases clear any previously queued reload cleanup", () => {
  const storage = createStorage({
    "tc-release-control-on-next-load": JSON.stringify(["machine-a"]),
  });

  storePendingControlRelease(storage, []);

  assert.deepEqual(takePendingControlRelease(storage), []);
});

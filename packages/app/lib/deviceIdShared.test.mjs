import test from "node:test";
import assert from "node:assert/strict";

import { generateDeviceId } from "./deviceIdShared.ts";

test("generateDeviceId uses randomUUID when available", () => {
  const id = generateDeviceId({
    randomUUID: () => "uuid-value",
  });

  assert.equal(id, "uuid-value");
});

test("generateDeviceId falls back when randomUUID is unavailable", () => {
  const id = generateDeviceId({
    getRandomValues: (buffer) => {
      buffer.fill(0xab);
      return buffer;
    },
  });

  assert.match(id, /^tc-[a-z0-9]+-(ab){8}$/);
});

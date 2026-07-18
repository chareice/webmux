import { describe, expect, it } from "vitest";

import {
  readViewOnlyLock,
  writeViewOnlyLock,
  type ViewOnlyLockStorage,
} from "./viewOnlyLock";

function memoryStorage(): ViewOnlyLockStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("view-only lock", () => {
  it("persists and clears the lock", () => {
    const storage = memoryStorage();

    expect(readViewOnlyLock(storage)).toBe(false);
    writeViewOnlyLock(storage, true);
    expect(readViewOnlyLock(storage)).toBe(true);
    writeViewOnlyLock(storage, false);
    expect(readViewOnlyLock(storage)).toBe(false);
  });
});

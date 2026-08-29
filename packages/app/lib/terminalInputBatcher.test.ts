import { describe, expect, it } from "vitest";

import { createInputBatcher } from "./terminalInputBatcher";

function createHarness() {
  const sent: string[] = [];
  const scheduled: (() => void)[] = [];
  const batcher = createInputBatcher(
    (data) => sent.push(data),
    (cb) => scheduled.push(cb),
  );
  const runScheduled = () => {
    scheduled.shift()?.();
  };
  return { batcher, sent, scheduled, runScheduled };
}

describe("createInputBatcher", () => {
  it("coalesces same-tick pushes into one send, preserving order", () => {
    const { batcher, sent, runScheduled } = createHarness();
    batcher.push("a");
    batcher.push("b");
    batcher.push("c");
    expect(sent).toEqual([]);
    runScheduled();
    expect(sent).toEqual(["abc"]);
  });

  it("flush() sends immediately and the scheduled flush becomes a no-op", () => {
    const { batcher, sent, scheduled, runScheduled } = createHarness();
    batcher.push("a");
    batcher.flush();
    expect(sent).toEqual(["a"]);
    expect(scheduled).toHaveLength(1);
    runScheduled();
    expect(sent).toEqual(["a"]);
  });

  it("starts a new batch for pushes after a flush", () => {
    const { batcher, sent, runScheduled } = createHarness();
    batcher.push("a");
    batcher.flush();
    batcher.push("b");
    runScheduled();
    expect(sent).toEqual(["a", "b"]);
  });

  it("sends a single push as the identical string", () => {
    const { batcher, sent, runScheduled } = createHarness();
    batcher.push("only");
    runScheduled();
    expect(sent).toEqual(["only"]);
  });
});

import { describe, expect, it } from "vitest";

import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_SLOP_PX,
  createLongPressTracker,
} from "./longPress";

function pointer(
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  return { pointerId, clientX, clientY };
}

function createHarness() {
  const fired: Array<{ x: number; y: number }> = [];
  const pending = new Map<number, () => void>();
  let nextId = 1;
  const tracker = createLongPressTracker({
    onLongPress: (point) => fired.push(point),
    setTimeoutFn: (fn) => {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimeoutFn: (id) => {
      pending.delete(id);
    },
  });
  return {
    tracker,
    fired,
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const fn of callbacks) fn();
    },
    hasPending() {
      return pending.size > 0;
    },
  };
}

describe("createLongPressTracker", () => {
  it("fires after a 500ms hold within the 10px slop", () => {
    const { tracker, fired, flush } = createHarness();
    tracker.pointerDown(pointer(1, 40, 80));
    expect(fired).toEqual([]);
    flush();
    expect(fired).toEqual([{ x: 40, y: 80 }]);
    expect(LONG_PRESS_DELAY_MS).toBe(500);
    expect(LONG_PRESS_SLOP_PX).toBe(10);
  });

  it("cancels when the pointer moves beyond the slop before the delay", () => {
    const { tracker, fired, flush, hasPending } = createHarness();
    tracker.pointerDown(pointer(1, 0, 0));
    tracker.pointerMove(pointer(1, LONG_PRESS_SLOP_PX + 1, 0));
    expect(hasPending()).toBe(false);
    flush();
    expect(fired).toEqual([]);
  });

  it("still fires when the pointer moves within the slop", () => {
    const { tracker, fired, flush } = createHarness();
    tracker.pointerDown(pointer(1, 0, 0));
    tracker.pointerMove(pointer(1, LONG_PRESS_SLOP_PX, 0));
    flush();
    expect(fired).toEqual([{ x: 0, y: 0 }]);
  });

  it("cancels on early release", () => {
    const { tracker, fired, flush, hasPending } = createHarness();
    tracker.pointerDown(pointer(1, 10, 10));
    tracker.pointerUp(pointer(1, 10, 10));
    expect(hasPending()).toBe(false);
    flush();
    expect(fired).toEqual([]);
  });

  it("cancels on pointercancel", () => {
    const { tracker, fired, flush, hasPending } = createHarness();
    tracker.pointerDown(pointer(1, 10, 10));
    tracker.pointerCancel(pointer(1, 10, 10));
    expect(hasPending()).toBe(false);
    flush();
    expect(fired).toEqual([]);
  });
});

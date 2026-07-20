import { describe, expect, it } from "vitest";

import { createWheelDirectionGate } from "./terminalWheelGate";

const PIXEL = 0; // WheelEvent.DOM_DELTA_PIXEL
const LINE = 1; // WheelEvent.DOM_DELTA_LINE

function gateWithClock() {
  let now = 0;
  const gate = createWheelDirectionGate(() => now);
  return {
    at(t: number, deltaY: number, deltaMode = PIXEL) {
      now = t;
      return gate(deltaY, deltaMode);
    },
  };
}

describe("createWheelDirectionGate", () => {
  it("allows the first event and same-direction follow-ups", () => {
    const g = gateWithClock();
    expect(g.at(0, 10)).toBe(true);
    expect(g.at(16, 20)).toBe(true);
    expect(g.at(32, 5)).toBe(true);
  });

  it("swallows a tiny reversal right after scrolling (trackpad jitter)", () => {
    const g = gateWithClock();
    // user scrolls down (back to the bottom of tmux copy-mode)…
    expect(g.at(0, 15)).toBe(true);
    expect(g.at(16, 15)).toBe(true);
    // …then the finger lift wobbles a few px upward — must NOT re-enter
    // copy-mode, so the gate swallows it
    expect(g.at(32, -6)).toBe(false);
    expect(g.at(48, -8)).toBe(false);
  });

  it("lets a sustained reversal through once it accumulates real distance", () => {
    const g = gateWithClock();
    expect(g.at(0, 15)).toBe(true);
    expect(g.at(16, -6)).toBe(false); // 6px
    expect(g.at(32, -8)).toBe(false); // 14px
    expect(g.at(48, -12)).toBe(true); // 26px >= threshold: deliberate
    // direction switched: further ups flow freely
    expect(g.at(64, -4)).toBe(true);
  });

  it("allows a reversal after a pause (new deliberate gesture)", () => {
    const g = gateWithClock();
    expect(g.at(0, 15)).toBe(true);
    expect(g.at(500, -6)).toBe(true);
  });

  it("allows a large reversal immediately (notched mouse wheel)", () => {
    const g = gateWithClock();
    expect(g.at(0, 120)).toBe(true);
    expect(g.at(16, -120)).toBe(true);
  });

  it("treats line-mode deltas as large enough to reverse immediately", () => {
    const g = gateWithClock();
    expect(g.at(0, 3, LINE)).toBe(true);
    expect(g.at(16, -3, LINE)).toBe(true);
  });

  it("ignores zero-delta events without touching state", () => {
    const g = gateWithClock();
    expect(g.at(0, 10)).toBe(true);
    expect(g.at(16, 0)).toBe(true);
    expect(g.at(32, -5)).toBe(false); // still gated against the down direction
  });

  it("resets the reversal accumulator when scrolling resumes in-direction", () => {
    const g = gateWithClock();
    expect(g.at(0, 15)).toBe(true);
    expect(g.at(16, -10)).toBe(false); // 10px opposite
    expect(g.at(32, 15)).toBe(true); // back in direction: accumulator resets
    expect(g.at(48, -10)).toBe(false); // needs to accumulate again
    expect(g.at(64, -10)).toBe(false); // 20px < threshold
    expect(g.at(80, -10)).toBe(true); // 30px >= threshold
  });
});

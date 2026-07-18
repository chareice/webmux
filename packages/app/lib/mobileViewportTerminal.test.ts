import { describe, expect, it } from "vitest";

import { getMobileViewportTerminalAction } from "./mobileViewportTerminal";

describe("getMobileViewportTerminalAction", () => {
  it("refits controllers on height changes and only scrolls viewers on shrink", () => {
    expect(
      getMobileViewportTerminalAction({
        isMobile: true,
        isActive: true,
        isController: true,
        previousHeight: 844,
        nextHeight: 500,
      }),
    ).toBe("refit");
    expect(
      getMobileViewportTerminalAction({
        isMobile: true,
        isActive: true,
        isController: true,
        previousHeight: 500,
        nextHeight: 844,
      }),
    ).toBe("refit");
    expect(
      getMobileViewportTerminalAction({
        isMobile: true,
        isActive: true,
        isController: false,
        previousHeight: 844,
        nextHeight: 500,
      }),
    ).toBe("scroll-to-bottom");
    expect(
      getMobileViewportTerminalAction({
        isMobile: true,
        isActive: true,
        isController: false,
        previousHeight: 500,
        nextHeight: 844,
      }),
    ).toBeNull();
  });

  it("does nothing outside the active mobile height-change path", () => {
    const baseline = {
      isMobile: true,
      isActive: true,
      isController: true,
      previousHeight: 844,
      nextHeight: 500,
    };

    expect(
      getMobileViewportTerminalAction({ ...baseline, isMobile: false }),
    ).toBeNull();
    expect(
      getMobileViewportTerminalAction({ ...baseline, isActive: false }),
    ).toBeNull();
    expect(
      getMobileViewportTerminalAction({ ...baseline, nextHeight: 844 }),
    ).toBeNull();
    expect(
      getMobileViewportTerminalAction({ ...baseline, previousHeight: null }),
    ).toBeNull();
  });
});

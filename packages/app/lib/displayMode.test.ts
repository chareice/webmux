import { describe, expect, it } from "vitest";

import { classifyDisplayMode } from "./displayMode";

describe("classifyDisplayMode", () => {
  it("treats the Fold 8 cover screen as compact in portrait", () => {
    // Cover ~384×832 CSS px: short edge 384 < 600.
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 384,
        screenHeight: 832,
        windowWidth: 384,
      }),
    ).toEqual({ isCompact: true, isTouch: true });
  });

  it("treats the Fold 8 cover screen as compact in landscape", () => {
    // Cover landscape ~832×384 (or ~940×384): window width exceeds the old
    // 768 breakpoint, which used to flip into the desktop layout. Screen
    // short-edge stays 384, so compact is stable across rotation.
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 832,
        screenHeight: 384,
        windowWidth: 832,
      }),
    ).toEqual({ isCompact: true, isTouch: true });
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 940,
        screenHeight: 384,
        windowWidth: 940,
      }),
    ).toEqual({ isCompact: true, isTouch: true });
  });

  it("treats the Fold 8 inner screen as a large touch workspace in any orientation", () => {
    // Inner ~757×840: short edge 757 ≥ 600 → not compact, still touch.
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 757,
        screenHeight: 840,
        windowWidth: 757,
      }),
    ).toEqual({ isCompact: false, isTouch: true });
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 840,
        screenHeight: 757,
        windowWidth: 840,
      }),
    ).toEqual({ isCompact: false, isTouch: true });
  });

  it("keeps the legacy desktop window-width breakpoint for non-touch", () => {
    // Mouse desktop with a narrow window still uses the 768 path.
    expect(
      classifyDisplayMode({
        isTouch: false,
        screenWidth: 1280,
        screenHeight: 720,
        windowWidth: 700,
      }),
    ).toEqual({ isCompact: true, isTouch: false });
    expect(
      classifyDisplayMode({
        isTouch: false,
        screenWidth: 1280,
        screenHeight: 720,
        windowWidth: 768,
      }),
    ).toEqual({ isCompact: true, isTouch: false });
    expect(
      classifyDisplayMode({
        isTouch: false,
        screenWidth: 1280,
        screenHeight: 720,
        windowWidth: 769,
      }),
    ).toEqual({ isCompact: false, isTouch: false });
  });

  it("ignores window width for touch devices so a soft keyboard cannot flip the mode", () => {
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 384,
        screenHeight: 832,
        windowWidth: 900,
      }),
    ).toEqual({ isCompact: true, isTouch: true });
  });

  it("classifies a touch short-edge of 599 as compact and 600 as large", () => {
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 599,
        screenHeight: 900,
        windowWidth: 599,
      }),
    ).toEqual({ isCompact: true, isTouch: true });
    expect(
      classifyDisplayMode({
        isTouch: true,
        screenWidth: 600,
        screenHeight: 900,
        windowWidth: 600,
      }),
    ).toEqual({ isCompact: false, isTouch: true });
  });
});

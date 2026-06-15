import { describe, expect, it } from "vitest";

import {
  getTerminalFitResizeDecision,
  getTerminalViewportLayout,
} from "./terminalViewModel";

describe("getTerminalViewportLayout", () => {
  it("keeps immersive terminals at native scale when scaling is disabled", () => {
    const layout = getTerminalViewportLayout({
      displayMode: "immersive",
      viewportWidth: 1280,
      viewportHeight: 360,
      contentWidth: 640,
      contentHeight: 720,
      allowScale: false,
    });

    expect(layout.scale).toBe(1);
    expect(layout.frameWidth).toBe(640);
    expect(layout.frameHeight).toBe(720);
    expect(layout.justifyContent).toBe("center");
  });

  it("shrinks tall immersive terminals to the available height", () => {
    const layout = getTerminalViewportLayout({
      displayMode: "immersive",
      viewportWidth: 1280,
      viewportHeight: 360,
      contentWidth: 640,
      contentHeight: 720,
    });

    expect(layout.scale).toBe(0.5);
    expect(layout.frameWidth).toBe(320);
    expect(layout.frameHeight).toBe(360);
    expect(layout.justifyContent).toBe("center");
  });
});

describe("getTerminalFitResizeDecision", () => {
  it("suppresses only the remote resize frame when auto-fit dimensions are unchanged", () => {
    expect(
      getTerminalFitResizeDecision({
        currentCols: 52,
        currentRows: 27,
        nextCols: 52,
        nextRows: 27,
        skipIfUnchanged: true,
      }),
    ).toEqual({
      sendResizeFrame: false,
      refreshLocalSurface: true,
    });
  });
});

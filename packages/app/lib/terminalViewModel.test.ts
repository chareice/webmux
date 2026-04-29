import { describe, expect, it } from "vitest";

import { getTerminalViewportLayout } from "./terminalViewModel";

describe("getTerminalViewportLayout", () => {
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

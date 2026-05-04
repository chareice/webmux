import { describe, expect, it } from "vitest";

import { ANDROID_TERMINAL_HTML } from "./nativeTerminalHtml";

describe("ANDROID_TERMINAL_HTML", () => {
  it("translates Android touch gestures into xterm scrollback movement", () => {
    expect(ANDROID_TERMINAL_HTML).toContain("touchmove");
    expect(ANDROID_TERMINAL_HTML).toContain("capture: true");
    expect(ANDROID_TERMINAL_HTML).toContain("new WheelEvent");
    expect(ANDROID_TERMINAL_HTML).toContain("dispatchEvent");
    expect(ANDROID_TERMINAL_HTML).toContain(".xterm-screen");
    expect(ANDROID_TERMINAL_HTML).toContain(".xterm");
    expect(ANDROID_TERMINAL_HTML).toContain("TOUCH_SCROLL_WHEEL_SCALE");
    expect(ANDROID_TERMINAL_HTML).toContain("preventDefault");
  });

  it("keeps terminal output inside the native viewport", () => {
    expect(ANDROID_TERMINAL_HTML).toContain("overflow-y:scroll");
    expect(ANDROID_TERMINAL_HTML).toContain("-webkit-overflow-scrolling:touch");
    expect(ANDROID_TERMINAL_HTML).toContain("scrollback: 5000");
  });
});

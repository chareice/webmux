import { describe, expect, it } from "vitest";
import source from "./TerminalView.xterm.tsx?raw";

describe("TerminalView renderer", () => {
  it("does not enable the WebGL renderer for live terminals by default", () => {
    expect(source).not.toContain("@xterm/addon-webgl");
    expect(source).not.toContain("new WebglAddon");
  });
});

import { describe, expect, it } from "vitest";
import expandedTerminalSource from "./ExpandedTerminal.web.tsx?raw";
import terminalCardSource from "./TerminalCard.web.tsx?raw";
import terminalGridCardSource from "./TerminalGridCard.web.tsx?raw";
import source from "./TerminalView.xterm.tsx?raw";

describe("TerminalView renderer", () => {
  it("does not enable the WebGL renderer for live terminals by default", () => {
    expect(source).not.toContain("@xterm/addon-webgl");
    expect(source).not.toContain("new WebglAddon");
  });

  it("does not scale live xterm surfaces with CSS transforms", () => {
    expect(source).not.toContain("transform:");
    expect(source).not.toContain("scale(");
    expect(source).not.toContain("allowTerminalScale");
    expect(source).not.toContain("patchScaledMouseCoordinates");
  });

  it("keeps terminal previews on the plain text renderer", () => {
    for (const previewSource of [
      terminalCardSource,
      terminalGridCardSource,
      expandedTerminalSource,
    ]) {
      expect(previewSource).toContain("TerminalPreviewText");
      expect(previewSource).not.toContain("outputSource=");
      expect(previewSource).not.toContain("allowTerminalScale");
      expect(previewSource).not.toContain("scale(0.35)");
      expect(previewSource).not.toContain("PREVIEW_SCALE");
    }
  });
});

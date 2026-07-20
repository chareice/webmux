import { describe, expect, it } from "vitest";
// @ts-expect-error Vitest runs this source check in Node, but the app tsconfig intentionally omits Node types.
import { readFileSync } from "node:fs";
import terminalCardSource from "./TerminalCard.web.tsx?raw";
import source from "./TerminalView.xterm.tsx?raw";

const globalCss = readFileSync(new URL("../global.css", import.meta.url), "utf8");

describe("TerminalView renderer", () => {
  it("does not enable the WebGL renderer for live terminals by default", () => {
    expect(source).not.toContain("@xterm/addon-webgl");
    expect(source).not.toContain("new WebglAddon");
  });

  it("does not scale live xterm surfaces with CSS transforms", () => {
    expect(source).not.toContain("transform:");
    expect(source).not.toContain("scale(");
    expect(source).not.toContain("allowTerminalScale");
  });

  it("keeps xterm custom glyphs enabled for block and shade characters", () => {
    expect(source).not.toContain("customGlyphs: false");
  });

  it("hides both native and xterm-managed terminal scrollbars", () => {
    expect(globalCss).toContain(".xterm .xterm-viewport");
    expect(globalCss).toContain(".xterm .xterm-scrollable-element > .scrollbar");
  });

  it("keeps terminal previews on the plain text renderer", () => {
    for (const previewSource of [terminalCardSource]) {
      expect(previewSource).toContain("TerminalPreviewText");
      expect(previewSource).not.toContain("outputSource=");
      expect(previewSource).not.toContain("allowTerminalScale");
      expect(previewSource).not.toContain("scale(0.35)");
      expect(previewSource).not.toContain("PREVIEW_SCALE");
    }
  });
});

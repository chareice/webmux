import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  PREFERRED_TERMINAL_FONTS,
  resolveTerminalFontFamily,
} from "./terminalFonts";

describe("terminalFonts", () => {
  it("prefers Maple Mono NF CN by default for CJK terminal rendering", () => {
    expect(PREFERRED_TERMINAL_FONTS[0]).toBe("Maple Mono NF CN");
    expect(DEFAULT_TERMINAL_FONT_FAMILY).toMatch(/^'Maple Mono NF CN'/);
  });

  it("uses the default terminal font stack when no custom font is configured", () => {
    expect(resolveTerminalFontFamily(null)).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(resolveTerminalFontFamily("")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });

  it("preserves an explicitly configured terminal font", () => {
    expect(resolveTerminalFontFamily("JetBrains Mono")).toBe(
      "'JetBrains Mono', monospace",
    );
  });
});

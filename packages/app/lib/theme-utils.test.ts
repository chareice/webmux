import test from "node:test";
import assert from "node:assert/strict";

import {
  getRunStatusThemeColor,
  getThemeColors,
  normalizeThemePreference,
  resolveAppColorScheme,
} from "./theme-utils.ts";

test("normalizeThemePreference falls back to system for unknown values", () => {
  assert.equal(normalizeThemePreference("sepia"), "system");
  assert.equal(normalizeThemePreference(null), "system");
});

test("resolveAppColorScheme follows the system theme when preference is system", () => {
  assert.equal(resolveAppColorScheme("system", "dark"), "dark");
  assert.equal(resolveAppColorScheme("system", "light"), "light");
  assert.equal(resolveAppColorScheme("system", null), "light");
});

test("getThemeColors returns a dark palette with light foreground text", () => {
  const colors = getThemeColors("dark");

  assert.equal(colors.background, "#1a1612");
  assert.equal(colors.foreground, "#f5eee4");
});

test("getRunStatusThemeColor uses theme-aware foregrounds for active states", () => {
  const colors = getThemeColors("dark");

  assert.equal(getRunStatusThemeColor("running", colors), colors.accent);
  assert.equal(getRunStatusThemeColor("failed", colors), colors.red);
});

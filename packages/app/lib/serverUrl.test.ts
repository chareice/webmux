import { describe, expect, it } from "vitest";

import { resolveServerUrl } from "./serverUrl";

describe("resolveServerUrl", () => {
  it("keeps hosted web builds same-origin", () => {
    expect(
      resolveServerUrl({
        platformOs: "web",
        isTauriRuntime: false,
        storedUrl: "https://offdesk.example",
      }),
    ).toBe("");
  });

  it("keeps a page a hub served same-origin, even inside the mobile app", () => {
    expect(
      resolveServerUrl({
        platformOs: "web",
        isTauriRuntime: true,
        isBundledOrigin: false,
        storedUrl: null,
        configuredDefaultUrl: "https://someone-elses-hub.example",
      }),
    ).toBe("");
  });

  it("has no hub of its own to fall back on", () => {
    expect(
      resolveServerUrl({
        platformOs: "android",
        isTauriRuntime: false,
        storedUrl: null,
      }),
    ).toBe("");
  });

  it("uses a configured native hub URL before the production fallback", () => {
    expect(
      resolveServerUrl({
        platformOs: "android",
        isTauriRuntime: false,
        storedUrl: null,
        configuredDefaultUrl: "http://10.0.2.2:4317/",
      }),
    ).toBe("http://10.0.2.2:4317");
  });

  it("uses the configured default on the app's own bundled screens", () => {
    expect(
      resolveServerUrl({
        platformOs: "web",
        isTauriRuntime: true,
        isBundledOrigin: true,
        storedUrl: null,
        configuredDefaultUrl: "https://preset.example/",
      }),
    ).toBe("https://preset.example");
  });

  it("keeps an explicitly saved hub URL above the configured default", () => {
    expect(
      resolveServerUrl({
        platformOs: "android",
        isTauriRuntime: false,
        storedUrl: "https://saved.example/",
        configuredDefaultUrl: "http://10.0.2.2:4317",
      }),
    ).toBe("https://saved.example");
  });
});

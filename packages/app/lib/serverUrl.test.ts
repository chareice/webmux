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

  it("uses the default hub URL for native Android builds", () => {
    expect(
      resolveServerUrl({
        platformOs: "android",
        isTauriRuntime: false,
        storedUrl: null,
      }),
    ).toBe("https://offdesk.nas.chareice.site");
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

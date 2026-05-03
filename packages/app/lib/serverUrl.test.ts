import { describe, expect, it } from "vitest";

import { resolveServerUrl } from "./serverUrl";

describe("resolveServerUrl", () => {
  it("keeps hosted web builds same-origin", () => {
    expect(
      resolveServerUrl({
        platformOs: "web",
        isTauriRuntime: false,
        storedUrl: "https://webmux.example",
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
    ).toBe("https://webmux.nas.chareice.site");
  });
});

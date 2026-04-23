import { describe, expect, it } from "vitest";

import {
  getNativeZellijUnavailableCopy,
  isNativeZellijReady,
} from "./nativeZellij";

describe("nativeZellij helpers", () => {
  it("recognizes a ready native zellij payload", () => {
    expect(
      isNativeZellijReady({
        status: "ready",
        session_name: "webmux-user-aaaa",
        session_path: "/webmux-user-aaaa",
        base_url: "https://node:8443",
        login_token: "token",
      }),
    ).toBe(true);
  });

  it("maps missing binary to a concise unavailable state", () => {
    expect(
      getNativeZellijUnavailableCopy({
        status: "unavailable",
        reason: "missing_binary",
        instructions: "Install zellij on this machine and restart webmux-node.",
      }),
    ).toEqual({
      title: "Zellij not installed",
      detail: "Install zellij on this machine and restart the node service.",
    });
  });
});

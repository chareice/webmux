import { describe, expect, it } from "vitest";

import {
  buildNativeOAuthUrl,
  getTokenFromNativeAuthUrl,
} from "./nativeAuth";

describe("buildNativeOAuthUrl", () => {
  it("sends the native callback to the hub OAuth endpoint", () => {
    expect(
      buildNativeOAuthUrl("https://webmux.example/", "google"),
    ).toBe(
      "https://webmux.example/api/auth/google?mobile_callback=webmux%3A%2F%2Fauth",
    );
  });
});

describe("getTokenFromNativeAuthUrl", () => {
  it("extracts the token from the app auth callback", () => {
    expect(getTokenFromNativeAuthUrl("webmux://auth?token=jwt.token")).toBe(
      "jwt.token",
    );
  });

  it("ignores non-auth deep links", () => {
    expect(getTokenFromNativeAuthUrl("webmux://settings?token=jwt.token")).toBe(
      null,
    );
  });
});

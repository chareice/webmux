import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTauri, isTauriMobile } from "./platform";

describe("isTauri / isTauriMobile", () => {
  const ORIGINAL_WINDOW = globalThis.window;
  const ORIGINAL_NAVIGATOR = globalThis.navigator;

  beforeEach(() => {
    // Recreate a fresh window for each test so __TAURI_INTERNALS__ flips
    // cleanly between cases.
    vi.stubGlobal("window", { __TAURI_INTERNALS__: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_WINDOW === undefined) {
      // @ts-expect-error -- cleanup
      delete globalThis.window;
    } else {
      vi.stubGlobal("window", ORIGINAL_WINDOW);
    }
    if (ORIGINAL_NAVIGATOR === undefined) {
      // @ts-expect-error -- cleanup
      delete globalThis.navigator;
    } else {
      vi.stubGlobal("navigator", ORIGINAL_NAVIGATOR);
    }
  });

  it("isTauri returns false when __TAURI_INTERNALS__ is missing", () => {
    vi.stubGlobal("window", {});
    expect(isTauri()).toBe(false);
  });

  it("isTauri returns true when __TAURI_INTERNALS__ is present", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
  });

  it("isTauriMobile is false outside Tauri even on Android UA", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64) AppleWebKit/537.36",
    });
    expect(isTauriMobile()).toBe(false);
  });

  it("isTauriMobile is true under Tauri on Android UA", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64) AppleWebKit/537.36",
    });
    expect(isTauriMobile()).toBe(true);
  });

  it("isTauriMobile is true under Tauri on iPhone UA", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(isTauriMobile()).toBe(true);
  });

  it("isTauriMobile is false under Tauri on macOS UA", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
    });
    expect(isTauriMobile()).toBe(false);
  });

  it("isTauriMobile is false under Tauri on Linux desktop UA", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    });
    expect(isTauriMobile()).toBe(false);
  });
});

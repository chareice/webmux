import { describe, expect, it, vi } from "vitest";

import {
  createExternalUrlOpener,
  isSafeExternalUrl,
} from "./terminalLinks";

describe("isSafeExternalUrl", () => {
  it("allows https URLs", () => {
    expect(isSafeExternalUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("allows http URLs", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript URLs", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects file URLs", () => {
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects data URLs", () => {
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false,
    );
  });

  it("rejects garbage that is not a URL", () => {
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});

describe("createExternalUrlOpener", () => {
  it("opens safe URLs with tauriOpen when running in Tauri", () => {
    const tauriOpen = vi.fn();
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpen,
      windowOpen,
    });

    open("https://example.com");

    expect(tauriOpen).toHaveBeenCalledWith("https://example.com");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("opens safe URLs with windowOpen when not running in Tauri", () => {
    const tauriOpen = vi.fn();
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpen,
      windowOpen,
    });

    open("http://example.com");

    expect(windowOpen).toHaveBeenCalledWith("http://example.com");
    expect(tauriOpen).not.toHaveBeenCalled();
  });

  it("never reaches either sink for an unsafe URL", () => {
    const tauriOpen = vi.fn();
    const windowOpen = vi.fn();
    const tauriOpener = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpen,
      windowOpen,
    });
    const webOpener = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpen,
      windowOpen,
    });

    tauriOpener("javascript:alert(1)");
    webOpener("file:///etc/passwd");
    tauriOpener("data:text/html,hi");
    webOpener("not a url");

    expect(tauriOpen).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });
});

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
  it("opens safe URLs with windowOpen when not running in Tauri", () => {
    const tauriOpenUrl = vi.fn();
    const tauriShellOpen = vi.fn();
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    open("http://example.com");

    expect(windowOpen).toHaveBeenCalledWith("http://example.com");
    expect(tauriOpenUrl).not.toHaveBeenCalled();
    expect(tauriShellOpen).not.toHaveBeenCalled();
  });

  it("opens safe URLs with tauriOpenUrl when running in Tauri", () => {
    const tauriOpenUrl = vi.fn().mockResolvedValue(undefined);
    const tauriShellOpen = vi.fn();
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    open("https://example.com");

    expect(tauriOpenUrl).toHaveBeenCalledWith("https://example.com");
    expect(tauriShellOpen).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("falls back to tauriShellOpen when tauriOpenUrl rejects", async () => {
    const tauriOpenUrl = vi.fn().mockRejectedValue(new Error("opener failed"));
    const tauriShellOpen = vi.fn().mockResolvedValue(undefined);
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    open("https://example.com");

    await vi.waitFor(() => {
      expect(tauriShellOpen).toHaveBeenCalledWith("https://example.com");
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("falls back to tauriShellOpen when tauriOpenUrl throws synchronously", async () => {
    const tauriOpenUrl = vi.fn((): Promise<unknown> => {
      throw new Error("plugin missing");
    });
    const tauriShellOpen = vi.fn().mockResolvedValue(undefined);
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    open("https://example.com");

    await vi.waitFor(() => {
      expect(tauriShellOpen).toHaveBeenCalledWith("https://example.com");
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("falls back to windowOpen when tauriOpenUrl and tauriShellOpen both reject", async () => {
    const tauriOpenUrl = vi.fn().mockRejectedValue(new Error("opener failed"));
    const tauriShellOpen = vi.fn().mockRejectedValue(new Error("shell failed"));
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    open("https://example.com");

    await vi.waitFor(() => {
      expect(windowOpen).toHaveBeenCalledWith("https://example.com");
    });
  });

  it("never reaches any sink for an unsafe URL", () => {
    const tauriOpenUrl = vi.fn();
    const tauriShellOpen = vi.fn();
    const windowOpen = vi.fn();
    const tauriOpener = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });
    const webOpener = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    tauriOpener("javascript:alert(1)");
    webOpener("file:///etc/passwd");
    tauriOpener("data:text/html,hi");
    webOpener("not a url");

    expect(tauriOpenUrl).not.toHaveBeenCalled();
    expect(tauriShellOpen).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("never throws or leaves an unhandled rejection when opener and shell fail", async () => {
    const tauriOpenUrl = vi.fn().mockRejectedValue(new Error("opener failed"));
    const tauriShellOpen = vi.fn().mockRejectedValue(new Error("shell failed"));
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl,
      tauriShellOpen,
      windowOpen,
    });

    expect(() => {
      open("https://example.com");
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(windowOpen).toHaveBeenCalledWith("https://example.com");
    });
  });
});

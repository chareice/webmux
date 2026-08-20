import { describe, expect, it, vi } from "vitest";

import {
  createExternalUrlOpener,
  isSafeExternalUrl,
} from "./terminalLinks";
import type { ExternalUrlOpenOutcome } from "./terminalLinks";

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

  it("reports the channel that opened the URL", async () => {
    const outcomes: ExternalUrlOpenOutcome[] = [];
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl: vi.fn().mockResolvedValue(undefined),
      tauriShellOpen: vi.fn(),
      windowOpen: vi.fn(),
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    open("https://example.com");

    await vi.waitFor(() => {
      expect(outcomes).toEqual([
        { url: "https://example.com", channel: "opener", errors: [] },
      ]);
    });
  });

  it("reports a failure when nothing could open the URL", async () => {
    const outcomes: ExternalUrlOpenOutcome[] = [];
    const open = createExternalUrlOpener({
      isTauri: () => true,
      tauriOpenUrl: vi.fn().mockRejectedValue(new Error("opener missing")),
      tauriShellOpen: vi.fn().mockRejectedValue(new Error("no such process")),
      windowOpen: vi.fn(),
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    open("https://example.com");

    await vi.waitFor(() => {
      expect(outcomes).toHaveLength(1);
    });
    expect(outcomes[0].channel).toBeNull();
    expect(outcomes[0].url).toBe("https://example.com");
    expect(outcomes[0].errors).toEqual([
      "opener: opener missing",
      "shell: no such process",
      "window.open: no native opener available",
    ]);
  });

  it("gives up on a Tauri call that never settles and falls through", async () => {
    const outcomes: ExternalUrlOpenOutcome[] = [];
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => true,
      // A hung IPC bridge: the promise never settles.
      tauriOpenUrl: vi.fn(() => new Promise<unknown>(() => {})),
      tauriShellOpen: vi.fn(() => new Promise<unknown>(() => {})),
      windowOpen,
      onOutcome: (outcome) => outcomes.push(outcome),
      timeoutMs: 10,
    });

    open("https://example.com");

    await vi.waitFor(() => {
      expect(windowOpen).toHaveBeenCalledWith("https://example.com");
    });
    expect(outcomes[0].errors).toEqual([
      "opener: no response in 10ms",
      "shell: no response in 10ms",
      "window.open: no native opener available",
    ]);
    expect(outcomes[0].channel).toBeNull();
  });

  it("treats a thrown window.open as a failure rather than success", async () => {
    const outcomes: ExternalUrlOpenOutcome[] = [];
    const open = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpenUrl: vi.fn(),
      tauriShellOpen: vi.fn(),
      windowOpen: vi.fn(() => {
        throw new Error("denied");
      }),
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    open("https://example.com");

    expect(outcomes[0].channel).toBeNull();
    expect(outcomes[0].errors).toEqual(["window.open: denied"]);
  });

  it("keeps opening links when the outcome reporter throws", () => {
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpenUrl: vi.fn(),
      tauriShellOpen: vi.fn(),
      windowOpen,
      onOutcome: () => {
        throw new Error("reporter blew up");
      },
    });

    expect(() => open("https://example.com")).not.toThrow();
    expect(windowOpen).toHaveBeenCalledWith("https://example.com");
  });

  it("reports failure when window.open is known to be inert (Android WebView)", () => {
    const outcomes: ExternalUrlOpenOutcome[] = [];
    const windowOpen = vi.fn();
    const open = createExternalUrlOpener({
      isTauri: () => false,
      tauriOpenUrl: vi.fn(),
      tauriShellOpen: vi.fn(),
      windowOpen,
      canTrustWindowOpen: () => false,
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    open("https://example.com");

    expect(windowOpen).toHaveBeenCalledWith("https://example.com");
    expect(outcomes[0].channel).toBeNull();
    expect(outcomes[0].errors).toEqual([
      "window.open: no native opener available",
    ]);
  });
});

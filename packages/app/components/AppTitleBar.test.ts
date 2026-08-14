import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppTitleBar } from "./AppTitleBar.web";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; SM-F977B) AppleWebKit/537.36";
const LINUX_DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

function render(): string {
  return renderToStaticMarkup(createElement(AppTitleBar, { isMobile: false }));
}

describe("AppTitleBar", () => {
  const ORIGINAL_WINDOW = globalThis.window;
  const ORIGINAL_NAVIGATOR = globalThis.navigator;

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

  it("renders nothing outside Tauri (plain web)", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { userAgent: LINUX_DESKTOP_UA });
    expect(render()).toBe("");
  });

  it("renders nothing in the Tauri Android shell — no window to minimize/maximize", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA });
    expect(render()).toBe("");
  });

  it("renders the drag region and window controls on Tauri desktop", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("navigator", { userAgent: LINUX_DESKTOP_UA });
    const html = render();
    expect(html).toContain("data-tauri-drag-region");
  });
});

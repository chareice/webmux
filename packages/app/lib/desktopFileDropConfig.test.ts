import { describe, expect, it } from "vitest";

import desktopConfig from "../../desktop/src-tauri/tauri.conf.json";
import macosConfig from "../../desktop/src-tauri/tauri.macos.conf.json";

describe("desktop file drop", () => {
  it.each([
    ["Windows and Linux", desktopConfig],
    ["macOS", macosConfig],
  ])("lets %s file drops reach the HTML5 terminal handler", (_, config) => {
    expect(config.app.windows[0].dragDropEnabled).toBe(false);
  });
});

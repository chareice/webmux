import { expect, test, type Page } from "@playwright/test";
import type { Terminal } from "@xterm/xterm";
import { mobileOpenHostSheet, openApp } from "./helpers";

async function mockTerminal(page: Page) {
  await page.route("**/api/bootstrap", route => route.fulfill({ json: {
    snapshot_seq: 1, last_focused_terminal_id: "font-test",
    machines: [{ id: "e2e-node", name: "Test host", os: "linux", home_dir: "/tmp" }],
    terminals: [{ id: "font-test", machine_id: "e2e-node", title: "Font test", cwd: "/tmp", cols: 80, rows: 24, reachable: true }],
    workspace_groups: [], workspace_layouts: [], machine_stats: [], control_leases: [],
  } }));
  await page.routeWebSocket(/\/ws\/events/, () => {});
  await page.routeWebSocket(/\/ws\/terminal\//, socket => { socket.send(Buffer.from("Font sample ABC 0123 中文\r\n")); });
}
async function settings(page: Page) {
  if (await page.getByTestId("mobile-workbench").isVisible()) await mobileOpenHostSheet(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "UI Font", exact: true })).toBeVisible();
}
async function options(page: Page) {
  return page.evaluate(() => {
    const term = (window as unknown as { __offdeskTerminals?: Map<string, Terminal> }).__offdeskTerminals?.get("font-test");
    return term ? { family: term.options.fontFamily, size: term.options.fontSize } : null;
  });
}
for (const width of [390, 1280]) {
  test(`font preferences apply, persist, reset and update a live terminal at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await mockTerminal(page);
    await openApp(page);
    await expect.poll(() => options(page)).not.toBeNull();
    // Retain the actual instance: preference changes in another window must
    // update rendering without replacing the terminal or losing its buffer.
    await page.evaluate(() => {
      const win = window as unknown as { __offdeskTerminals: Map<string, Terminal>; savedTerminal?: Terminal };
      win.savedTerminal = win.__offdeskTerminals.get("font-test");
    });
    const preferences = await context.newPage();
    await mockTerminal(preferences);
    await openApp(preferences);
    await settings(preferences);
    await preferences.getByRole("combobox", { name: "UI Font", exact: true }).selectOption("Fredoka Variable");
    await expect(preferences.locator("body")).toHaveCSS("font-family", /Fredoka Variable/);
    await expect(page.locator("body")).toHaveCSS("font-family", /Fredoka Variable/);
    await preferences.getByRole("combobox", { name: "Terminal Font", exact: true }).selectOption("JetBrains Mono");
    await preferences.getByRole("spinbutton", { name: "Terminal Font Size", exact: true }).fill("20");
    await expect.poll(() => options(page)).toEqual({ family: "'JetBrains Mono', monospace", size: 20 });
    expect(await page.evaluate(() => Array.from(document.fonts).some(font => font.family.replace(/["']/g, "") === "JetBrains Mono" && font.status === "loaded"))).toBe(true);
    expect(await page.evaluate(() => {
      const win = window as unknown as { __offdeskTerminals: Map<string, Terminal>; savedTerminal: Terminal };
      return win.savedTerminal === win.__offdeskTerminals.get("font-test");
    })).toBe(true);
    await preferences.getByTitle("Back", { exact: true }).click();
    await expect.poll(() => options(preferences)).toEqual({ family: "'JetBrains Mono', monospace", size: 20 });
    await page.reload();
    await expect(page.locator("body")).toHaveCSS("font-family", /Fredoka Variable/);
    await expect.poll(() => options(page)).toEqual({ family: "'JetBrains Mono', monospace", size: 20 });
    await settings(preferences);
    await preferences.getByRole("combobox", { name: "UI Font", exact: true }).selectOption("System UI");
    await expect(preferences.locator("body")).toHaveCSS("font-family", /system-ui/);
    await preferences.getByRole("combobox", { name: "UI Font", exact: true }).selectOption("App Default");
    await expect(page.locator("body")).toHaveCSS("font-family", /Nunito Variable/);
    await preferences.getByRole("combobox", { name: "Terminal Font", exact: true }).selectOption("Auto Detect");
    await preferences.getByRole("spinbutton", { name: "Terminal Font Size", exact: true }).fill("");
    await expect.poll(async () => (await options(page))?.size).toBe(14);
    await expect.poll(async () => (await options(page))?.family).toMatch(/^'Maple Mono NF CN'/);
    await context.close();
  });
}

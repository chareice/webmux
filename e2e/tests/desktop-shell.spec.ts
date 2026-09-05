import { expect, test, type Page } from "@playwright/test";
import { createTerminalViaApi, expandTerminalById, requestMachineControl, resetMachineState, openApp, pressPrefixKey } from "./helpers";

// Exercise the bundled desktop route with a fake native bridge. Real hub
// requests still go through the E2E hub; no native services are installed.
async function desktopBridge(page: Page, role: "client" | null = "client") {
  await page.addInitScript((initialRole) => {
    let role = initialRole;
    let callbackId = 0;
    const callbacks = new Map<number, (data: unknown) => void>();
    const state = { updater: "current", calls: [] as string[] };
    Object.assign(window, { __desktopTest: state });
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: (callback: (data: unknown) => void) => {
          callbacks.set(++callbackId, callback);
          return callbackId;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args?: { role?: "client"; handler?: number }) => {
          state.calls.push(command);
          if (command === "desktop_role") return role;
          if (command === "set_desktop_role") { role = args?.role ?? "client"; return; }
          if (command === "plugin:app|version") return "0.5.3-test";
          if (command === "plugin:updater|check") {
            if (state.updater === "error") throw new Error("Update server unavailable");
            if (state.updater === "available") return { rid: 7, currentVersion: "0.5.3", version: "0.5.4", rawJson: {} };
            return null;
          }
          if (command === "plugin:event|listen") return args?.handler ?? 1;
          if (command === "plugin:window|is_maximized") return false;
          return undefined;
        },
      },
    });
  }, role);
}

test("desktop settings, theme, update recovery and menus work in a small window", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 800, height: 600 });
  await desktopBridge(page);
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  const terminalId = await createTerminalViaApi(page, { cwd: "/tmp", startupCommand: "printf 'Desktop audit\\n'; sleep 600" });
  await expandTerminalById(page, terminalId);
  await expect(page.getByTestId("app-title-bar")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByText("Shell version: 0.5.3-test")).toBeVisible();
  const updates = page.getByTestId("desktop-update-settings");
  await page.evaluate(() => { (window as any).__desktopTest.updater = "error"; });
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("alert")).toContainText("Update server unavailable");
  await page.evaluate(() => { (window as any).__desktopTest.updater = "current"; });
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("status")).toHaveText("You’re up to date.");
  await page.evaluate(() => { (window as any).__desktopTest.updater = "available"; });
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect(updates.getByRole("button", { name: "Install update" })).toBeEnabled();
  // If another installation already picked up the update, don't get stuck.
  await page.evaluate(() => { (window as any).__desktopTest.updater = "current"; });
  await updates.getByRole("button", { name: "Install update" }).click();
  await expect(updates.getByRole("status")).toHaveText("You’re up to date.");
  await expect(updates.getByRole("button", { name: "Check for updates" })).toBeEnabled();

  await page.getByRole("textbox", { name: "Server URL" }).fill("not a hub");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("valid http:// or https://");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("offdesk:token"))).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("desktop-settings-dark.png") });
  await page.getByTitle("Back", { exact: true }).click();
  await pressPrefixKey(page, "k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+,");
  await expect(page.getByRole("group", { name: "Theme", exact: true })).toBeVisible();
  await page.getByTitle("Back", { exact: true }).click();
  await page.getByTestId("desktop-workspace-manager-button").click();
  await expect(page.getByTestId("workspace-manager")).toBeVisible();
  await page.getByTestId("workspace-manager-close").click();
  await page.getByTestId("tab-bar-phone").click();
  await expect(page.getByTestId("phone-dialog")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-phone-dark.png") });
  await page.getByTestId("phone-dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("desktop-workbench-dark.png") });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByTitle("Back", { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("desktop-workbench-light.png") });
  expect(pageErrors).toEqual([]);
});

test("changing the desktop hub drops the previous hub login", async ({ page }) => {
  await desktopBridge(page);
  const response = await page.request.get("/api/auth/dev");
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  await page.addInitScript((token) => {
    if (!sessionStorage.getItem("desktop-auth-seeded")) {
      localStorage.setItem("offdesk:token", token);
      sessionStorage.setItem("desktop-auth-seeded", "1");
    }
  }, token);
  await page.route("https://other-hub.example/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Server URL" }).fill("https://other-hub.example");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("offdesk:server_url"))).toBe("https://other-hub.example");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("offdesk:token"))).toBeNull();
});

test("desktop startup keeps window controls and content reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await desktopBridge(page, null);
  await page.addInitScript(() => Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" }));
  await page.goto("/");
  await expect(page.getByTestId("first-run-client")).toBeVisible();
  await expect(page.getByTestId("app-title-bar")).toHaveCount(1);
  // The CI browser's Linux UA exercises the custom non-macOS controls.
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__desktopTest.calls)).toContain("plugin:window|minimize");
  await page.getByTestId("first-run-client").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("desktop-first-run.png") });
});

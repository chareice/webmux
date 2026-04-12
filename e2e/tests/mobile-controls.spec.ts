import { test, expect, devices } from "@playwright/test";

import {
  expectSingleTerminalCard,
  expandMachineSection,
  openApp,
  resetMachineState,
} from "./helpers";

test.use({
  ...devices["iPhone 14"],
  browserName: "chromium",
});

test("mobile terminal flow works inside the responsive web shell", async ({ page }) => {
  const proofFile = `e2e-mobile-${Date.now().toString(36)}.txt`;

  await openApp(page);
  await resetMachineState(page);

  await expect(page.getByTestId("mobile-sidebar-toggle")).toBeVisible();
  await expect(page.getByText("Tap ☰ to open a terminal")).toBeVisible();
  await expect(page.getByTestId("statusbar-stat-cpu")).toContainText("CPU");
  await expect(page.getByTestId("statusbar-stat-memory")).toContainText("MEM");
  await expect(page.getByTestId("statusbar-mode-toggle")).toHaveText("Control Here");

  await page.getByTestId("statusbar-mode-toggle").click();
  await expect(page.getByTestId("statusbar-mode-toggle")).toHaveText("Stop Control");

  await page.getByTestId("mobile-sidebar-toggle").click();
  await expandMachineSection(page);
  await page.getByTestId("machine-bookmark-local-home").click();

  const card = await expectSingleTerminalCard(page);
  await expect(card.locator(".xterm")).toHaveCount(1);
  await expect(card.getByLabel("Maximize")).toBeVisible();
  await card.getByLabel("Maximize").click();

  await expect(page.getByLabel("Minimize")).toBeVisible();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");
  await expect(page.getByTestId("terminal-fit-button")).toHaveText("Use This Size");
  await expect(page.getByTitle("Show command bar")).toBeVisible();

  await page.getByTitle("Show command bar").click();
  const commandInput = page.getByTestId("command-bar-input");
  await expect(commandInput).toBeVisible();
  await commandInput.fill(`: >/tmp/${proofFile}`);
  await page.getByTestId("command-bar-send").click();
  const token = await page.evaluate(() => localStorage.getItem("webmux:token"));
  expect(token).toBeTruthy();

  await expect
    .poll(async () => {
      const response = await page.request.get(
        "/api/machines/e2e-node/fs/list?path=%2Ftmp",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok()) {
        return [];
      }

      const entries = await response.json();
      return entries.map((entry: { name: string }) => entry.name);
    })
    .toContain(proofFile);

  await page.getByTitle("Hide command bar").click();
  await expect(commandInput).toBeHidden();

  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Control Here");
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");

  await page.getByLabel("Minimize").click();
  await expect(card.getByLabel("Maximize")).toBeVisible();
  await card.getByLabel("Close terminal").click();
  await expect(page.locator("[data-testid^='terminal-card-']")).toHaveCount(0);
  await expect(page.getByText("Tap ☰ to open a terminal")).toBeVisible();
});

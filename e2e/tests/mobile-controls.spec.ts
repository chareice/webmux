import { test, expect, devices } from "@playwright/test";

import {
  expandMachineSection,
  getImmersiveTerminal,
  openApp,
  resetMachineState,
} from "./helpers";

test.use({
  ...devices["iPhone 14"],
  browserName: "chromium",
});

test("mobile terminal flow works inside the responsive web shell", async ({ page }) => {
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

  // After creating, terminal auto-switches to tab (immersive) view
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");
  await expect(page.getByTestId("terminal-fit-button")).toHaveText("Fit to Window");
  // Mobile extended key bar keeps the keyboard toggle available in control mode
  await expect(page.getByTitle("Show keyboard")).toBeVisible();

  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Control Here");
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");

  // Switch to grid view via "All" tab, then close the terminal from the card
  await page.getByTestId("tab-all").click();
  const card = page.locator("[data-testid^='terminal-card-']:visible").first();
  await expect(card).toBeVisible();
  await card.getByLabel("Close terminal").click();
  await expect(page.locator("[data-testid^='terminal-card-']:visible")).toHaveCount(0);
  await expect(page.getByText("Tap ☰ to open a terminal")).toBeVisible();
});

import { test, expect, devices } from "@playwright/test";

import {
  openPanel,
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
  // Overview header is visible even on mobile (empty state sits below).
  await expect(page.getByText(/No terminals/)).toBeVisible();
  await expect(page.getByTestId("statusbar-stat-cpu")).toContainText("CPU");
  await expect(page.getByTestId("statusbar-stat-memory")).toContainText("MEM");
  await expect(page.getByTestId("statusbar-mode-toggle")).toHaveText("Control Here");

  await page.getByTestId("statusbar-mode-toggle").click();
  await expect(page.getByTestId("statusbar-mode-toggle")).toHaveText("Stop Control");

  // Open the mobile drawer (which renders the full panel), then select
  // the bookmark so the terminal is created.
  await page.getByTestId("mobile-sidebar-toggle").click();
  await openPanel(page);
  await page.getByTestId("panel-bookmark-local-home").click();

  // After creating, terminal auto-zooms (immersive view)
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");
  await expect(page.getByTestId("terminal-fit-button")).toHaveText("Fit to Window");
  // Mobile extended key bar keeps the keyboard toggle available in control mode
  await expect(page.getByTitle("Show keyboard")).toBeVisible();

  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Control Here");
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");

  // Close the terminal directly from the tab strip's close button. The mobile
  // sidebar toggle is hidden while a terminal is zoomed, so we can't navigate
  // via the panel — close the active tab instead.
  // The close button is visible for the active tab (isActive=true in TabStrip).
  await page.locator("[data-testid^='tab-close-']").first().click();
  // After closing the last terminal, the workpath has 0 terminals → State 3
  // (WorkpathEmptyState). The immersive terminal is gone.
  await expect(getImmersiveTerminal(page)).not.toBeVisible();
  await expect(page.getByTestId("workpath-empty")).toBeVisible();
});

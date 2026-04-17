import { test, expect, devices } from "@playwright/test";

import {
  expandNavColumn,
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

  // Open the mobile drawer (which renders the full NavColumn), then expand
  // its overlay so the bookmark row is interactive.
  await page.getByTestId("mobile-sidebar-toggle").click();
  await expandNavColumn(page);
  await page.getByTestId("overlay-bookmark-local-home").click();

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

  // Leave the zoomed view via the breadcrumb back button, then close
  // the terminal from its card in the Overview grid.
  await page.getByTestId("breadcrumb-back").click();
  await expect(page.getByTestId("overview-header")).toBeVisible();
  const card = page.locator("[data-testid^='terminal-card-']:visible").first();
  await expect(card).toBeVisible();
  await card.getByLabel("Close terminal").click();
  await expect(page.locator("[data-testid^='terminal-card-']:visible")).toHaveCount(0);
  await expect(page.getByText(/No terminals/)).toBeVisible();
});

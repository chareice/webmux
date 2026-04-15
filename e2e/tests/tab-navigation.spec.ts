import { test, expect } from "@playwright/test";

import {
  expandMachineSection,
  expectTerminalCount,
  getImmersiveTerminal,
  getTerminalCards,
  listTerminals,
  openApp,
  openRootBookmark,
  resetMachineState,
} from "./helpers";

test("tab-based terminal navigation: create, switch, close, URL hash sync", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);

  // Step 1: Initial state — no tabs, no terminals
  await expect(page.getByTestId("tab-all")).toHaveCount(0);
  await expect(
    page.getByText("Select a directory to open a terminal"),
  ).toBeVisible();

  // Take control and expand machine
  await expandMachineSection(page);
  await page.getByTestId("machine-request-control-e2e-node").click();
  await expect(page.getByTestId("canvas-mode-toggle")).toHaveText(
    "Stop Control",
  );

  // Step 2: Create first terminal — auto-switches to tab view
  await page.getByTestId("machine-bookmark-local-home").click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Tab bar should appear with "All" and one terminal tab
  await expect(page.getByTestId("tab-all")).toBeVisible();
  const terminals1 = await listTerminals(page);
  expect(terminals1).toHaveLength(1);
  const firstTerminalId = terminals1[0].id;

  // The terminal tab should be active
  const firstTab = page.getByTestId(`tab-${firstTerminalId}`);
  await expect(firstTab).toBeVisible();

  // URL hash should contain the terminal ID
  expect(page.url()).toContain(`#/t/${firstTerminalId}`);

  // Step 3: Click "All" — switch to grid
  await page.getByTestId("tab-all").click();
  await expectTerminalCount(page, 1);

  // Active Machine header should be visible in grid view
  await expect(page.getByText("Active Machine")).toBeVisible();
  await expect(page.getByTestId("canvas-mode-toggle")).toBeVisible();

  // URL hash should be cleared
  expect(page.url()).not.toContain("#/t/");

  // Step 4: Click card in grid — switch back to tab
  await getTerminalCards(page).first().click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  expect(page.url()).toContain(`#/t/${firstTerminalId}`);

  // Step 5: Create second terminal — auto-switches to new tab
  await openRootBookmark(page);
  await expect
    .poll(async () => (await listTerminals(page)).length)
    .toBe(2);

  const terminals2 = await listTerminals(page);
  const secondTerminalId = terminals2.find((t) => t.id !== firstTerminalId)!.id;

  // New tab should be active
  const secondTab = page.getByTestId(`tab-${secondTerminalId}`);
  await expect(secondTab).toBeVisible();
  expect(page.url()).toContain(`#/t/${secondTerminalId}`);

  // Both terminal tabs should exist
  await expect(firstTab).toBeVisible();
  await expect(secondTab).toBeVisible();

  // Step 6: Switch to first terminal tab
  await firstTab.click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  expect(page.url()).toContain(`#/t/${firstTerminalId}`);

  // Step 7: All tab shows grid with 2 cards
  await page.getByTestId("tab-all").click();
  await expectTerminalCount(page, 2);

  // Step 8: Close second terminal via tab close button
  // Find the close button next to the second terminal's tab
  const secondTabClose = page
    .locator(`[data-testid="tab-${secondTerminalId}"]`)
    .locator("..")
    .getByLabel("Close terminal");
  await secondTabClose.click();

  await expect
    .poll(async () => (await listTerminals(page)).length)
    .toBe(1);
  await expect(secondTab).toHaveCount(0);
  await expectTerminalCount(page, 1);

  // Step 9: Browser back button navigation
  await firstTab.click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  expect(page.url()).toContain(`#/t/${firstTerminalId}`);

  await page.goBack();
  // Should return to grid view
  await expect(page.getByTestId("tab-all")).toBeVisible();
  expect(page.url()).not.toContain("#/t/");

  // Step 10: Page reload preserves tab state via URL hash
  await firstTab.click();
  expect(page.url()).toContain(`#/t/${firstTerminalId}`);
  await page.reload();
  // Wait for app to reconnect (don't use openApp — it navigates to / and clears the hash)
  await page.waitForSelector("[data-testid^='terminal-card-']", { timeout: 20_000 });
  // The hash should still be set, and the terminal tab should be active
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Step 11: Re-take control (released on reload) and close terminal
  await page.getByTestId("tab-all").click();
  await page.getByTestId("canvas-mode-toggle").click();
  await expect(page.getByTestId("canvas-mode-toggle")).toHaveText("Stop Control");
  // Switch back to terminal tab and close from title bar
  await page.getByTestId(`tab-${firstTerminalId}`).click();
  await page.getByLabel("Close terminal").first().click();
  await expect
    .poll(async () => (await listTerminals(page)).length)
    .toBe(0);
  await expect(
    page.getByText("Select a directory to open a terminal"),
  ).toBeVisible();

  await context.close();
});

import { test, expect } from "@playwright/test";

import {
  openApp,
  getAuthHeaders,
  resetMachineState,
  expandNavColumn,
  expectTerminalCount,
  getImmersiveTerminal,
} from "./helpers";

test("quick command tags appear under bookmarks and launch terminals with the configured command", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);

  const headers = await getAuthHeaders(page);

  // Configure quick commands via API
  const putResponse = await page.request.put("/api/settings", {
    headers,
    data: {
      settings: {
        quick_commands: JSON.stringify([
          { label: "probe", command: "echo qc-probe-ok" },
        ]),
      },
    },
  });
  expect(putResponse.ok()).toBeTruthy();

  // Take control
  await page.getByTestId("statusbar-mode-toggle").click();
  await expect(page.getByTestId("statusbar-mode-toggle")).toHaveText("Stop Control");

  // Reload so the overlay picks up the new quick commands
  await page.reload();
  await page.getByTestId("statusbar-mode-toggle").waitFor({ state: "visible", timeout: 10_000 });

  // Expand nav column to see bookmarks and their quick-command chips
  await expandNavColumn(page);

  // The quick command tag should appear under the "~" bookmark (id: local-home)
  const probeTag = page.getByTestId("overlay-quick-cmd-local-home-probe");
  await expect(probeTag).toBeVisible();

  // Click the tag to create a terminal with the command
  await probeTag.click();

  // Terminal should open in immersive (zoomed) view
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Verify a terminal was created — back to the overview grid via breadcrumb
  await page.getByTestId("breadcrumb-back").click();
  await expect(page.getByTestId("overview-header")).toBeVisible();
  await expectTerminalCount(page, 1);

  // Clean up quick commands
  const cleanupResponse = await page.request.put("/api/settings", {
    headers,
    data: { settings: { quick_commands: "[]" } },
  });
  expect(cleanupResponse.ok()).toBeTruthy();
});

test("quick command tags are hidden when no commands are configured", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);

  const headers = await getAuthHeaders(page);

  // Ensure no quick commands
  await page.request.put("/api/settings", {
    headers,
    data: { settings: { quick_commands: "[]" } },
  });

  // Take control
  await page.getByTestId("statusbar-mode-toggle").click();
  await expect(page.getByTestId("statusbar-mode-toggle")).toHaveText("Stop Control");

  await page.reload();
  await page.getByTestId("statusbar-mode-toggle").waitFor({ state: "visible", timeout: 10_000 });

  // Expand the nav column overlay
  await expandNavColumn(page);

  // Bookmark should be visible but no quick command tags
  await expect(page.getByTestId("overlay-bookmark-local-home")).toBeVisible();
  await expect(page.getByTestId("overlay-quick-cmd-local-home-probe")).toBeHidden();
});

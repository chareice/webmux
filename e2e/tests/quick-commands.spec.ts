import { test, expect } from "@playwright/test";

import {
  openApp,
  getAuthHeaders,
  resetMachineState,
  openPanel,
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

  // Navigate into the "~" workpath via keyboard shortcut (Cmd+2 = first bookmark).
  // With 0 terminals, this triggers SELECT_WORKPATH without creating one → State 3
  // (WorkpathEmptyState with quick-command buttons visible).
  await openPanel(page);
  await page.keyboard.press("Meta+2");

  // The quick command tag should appear in the empty-state for local-home
  const probeTag = page.getByTestId("workpath-empty-quick-cmd-probe");
  await expect(probeTag).toBeVisible();

  // Click the tag to create a terminal with the command
  await probeTag.click();

  // Terminal should open in immersive (zoomed) view
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Verify exactly one terminal was created — back to overview via panel select-all
  await page.getByTestId("panel-select-all").click();
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

  // Navigate into the "~" workpath via keyboard shortcut (no terminal creation).
  // With no quick commands configured, the empty state should not show any quick cmd tag.
  await openPanel(page);
  await expect(page.getByTestId("panel-bookmark-local-home")).toBeVisible();
  await page.keyboard.press("Meta+2");
  // No quick commands configured — the tag must be absent from the empty state
  await expect(page.getByTestId("workpath-empty-quick-cmd-probe")).toHaveCount(0);
});

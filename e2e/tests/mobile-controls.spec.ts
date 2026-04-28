import { test, expect, devices } from "@playwright/test";

import {
  createTerminalViaApi,
  getImmersiveTerminal,
  listTerminals,
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

  // The mobile shell is a three-tab bottom-nav surface. The "Terminals" tab
  // is selected by default and shows the empty state.
  await expect(page.getByTestId("mobile-workbench")).toBeVisible();
  await expect(page.getByText(/No terminals here yet/)).toBeVisible();

  // Take control without leaving the Terminals tab.
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Control Here",
  );
  await page.getByTestId("mobile-control-toggle").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Stop Control",
  );

  // After taking control the FAB appears on the Terminals tab.
  await expect(page.getByTestId("mobile-fab-new-terminal")).toBeVisible();

  // Create a terminal — use the FAB.
  await page.getByTestId("mobile-fab-new-terminal").click();

  // Mobile auto-zooms after create → the ExpandedTerminal overlay opens at
  // full viewport size and the immersive TerminalCard renders inside.
  await expect(page.getByTestId("expanded-terminal")).toBeVisible();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Control toolbar inside the overlay (mobile-only): Fit to Window + mode
  // toggle. Shown because we're the controller.
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText(
    "Stop Control",
  );
  await expect(page.getByTestId("terminal-fit-button")).toHaveText(
    "Fit to Window",
  );
  // Extended key bar surfaces the keyboard toggle while controlling.
  await expect(page.getByTitle("Show keyboard")).toBeVisible();

  // Toggle control off and on via the in-terminal toggle.
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText(
    "Control Here",
  );
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText(
    "Stop Control",
  );

  // Close the overlay with the expanded-close button — this just dismisses
  // the overlay, the terminal stays alive.
  await page.getByTestId("expanded-close").click();
  await expect(page.getByTestId("expanded-terminal")).toHaveCount(0);

  // Back on the Terminals tab: the mobile card list shows the live terminal.
  await expect(page.locator("[data-testid^='mobile-term-card-']")).toHaveCount(1);

  // Destroy via API (no mobile UI path for destroying terminals yet).
  await createTerminalViaApi; // touch import to keep tree-shaking stable
  const [terminal] = await listTerminals(page);
  expect(terminal).toBeDefined();
  const deviceId = await page.evaluate(() => sessionStorage.getItem("tc-device-id"));
  const token = await page.evaluate(() => localStorage.getItem("webmux:token"));
  const resp = await page.request.delete(
    `/api/machines/${terminal.machine_id}/terminals/${terminal.id}?device_id=${encodeURIComponent(deviceId ?? "")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(resp.ok()).toBeTruthy();

  await expect(page.getByText(/No terminals here yet/)).toBeVisible();
});

test("mobile new terminal starts fitted without an immediate resize", async ({ page }) => {
  const terminalFramesSent: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") {
        terminalFramesSent.push(frame.payload);
      }
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await page.getByTestId("mobile-control-toggle").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Stop Control",
  );

  await page.getByTestId("mobile-fab-new-terminal").click();
  await expect(page.getByTestId("expanded-terminal")).toBeVisible();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await page.waitForTimeout(1_200);
  const resizeFrames = terminalFramesSent.filter((payload) =>
    payload.includes('"type":"resize"'),
  );
  expect(resizeFrames).toEqual([]);

  const [terminal] = await listTerminals(page);
  expect(terminal.cols).toBeLessThan(80);
});

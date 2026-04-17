import { test, expect } from "@playwright/test";

import {
  expectSingleTerminalCard,
  expandNavColumn,
  openApp,
  resetMachineState,
} from "./helpers";

test("desktop control handoff stays in sync across browser sessions", async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await openApp(pageA);
  await resetMachineState(pageA);
  await expandNavColumn(pageA);

  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await pageA.getByTestId("overlay-request-control-e2e-node").click();
  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Stop Control");

  // Create a terminal from the "~" bookmark — auto-zooms.
  await expandNavColumn(pageA);
  await pageA.getByTestId("overlay-bookmark-local-home").click();
  // Back to Overview grid so we can verify the card state.
  await pageA.getByTestId("breadcrumb-back").click();
  await expect(pageA.getByTestId("overview-header")).toBeVisible();
  const cardA = await expectSingleTerminalCard(pageA);
  await expect(cardA.getByLabel("Close terminal")).toBeVisible();

  await openApp(pageB);
  // Session B starts on the Overview grid (did not create the terminal),
  // so the shared card is already visible.
  await expect(pageB.getByTestId("overview-header")).toBeVisible();
  const cardB = await expectSingleTerminalCard(pageB);
  await expect(pageB.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await expect(cardB.getByLabel("View only - cannot close")).toBeVisible();

  await pageB.getByTestId("canvas-mode-toggle").click();
  await expect(pageB.getByTestId("canvas-mode-toggle")).toHaveText("Stop Control");
  await expect(cardB.getByLabel("Close terminal")).toBeVisible();

  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await expect(cardA.getByLabel("View only - cannot close")).toBeVisible();

  await cardB.getByLabel("Close terminal").click();
  await expect(pageA.locator("[data-testid^='terminal-card-']:visible")).toHaveCount(0);
  await expect(pageB.locator("[data-testid^='terminal-card-']:visible")).toHaveCount(0);
  // No terminals → empty-state inside Overview body.
  await expect(pageA.getByText(/No terminals/)).toBeVisible();
  await expect(pageB.getByText(/No terminals/)).toBeVisible();

  await pageA.reload();
  await pageB.reload();

  await openApp(pageA);
  await openApp(pageB);
  await expect(pageA.getByText(/No terminals/)).toBeVisible();
  await expect(pageB.getByText(/No terminals/)).toBeVisible();
  // pageA had no control before reload → stays without control
  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  // pageB had control before reload → auto-restored on reload
  await expect(pageB.getByTestId("canvas-mode-toggle")).toHaveText("Stop Control");

  await contextA.close();
  await contextB.close();
});

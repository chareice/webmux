import { test, expect } from "@playwright/test";

import {
  expectSingleTerminalCard,
  expandMachineSection,
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
  await expandMachineSection(pageA);

  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await pageA.getByTestId("machine-request-control-e2e-node").click();
  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Stop Control");

  await pageA.getByTestId("machine-bookmark-local-home").click();
  // Terminal auto-switches to tab view; go back to grid to verify card state
  await pageA.getByTestId("tab-all").click();
  const cardA = await expectSingleTerminalCard(pageA);
  await expect(cardA.getByLabel("Close terminal")).toBeVisible();

  await openApp(pageB);
  // Session B starts in grid view (didn't create the terminal)
  await pageB.getByTestId("tab-all").click();
  const cardB = await expectSingleTerminalCard(pageB);
  await expect(pageB.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await expect(cardB.getByLabel("View only - cannot close")).toBeVisible();

  await pageB.getByTestId("canvas-mode-toggle").click();
  await expect(pageB.getByTestId("canvas-mode-toggle")).toHaveText("Stop Control");
  await expect(cardB.getByLabel("Close terminal")).toBeVisible();

  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await expect(cardA.getByLabel("View only - cannot close")).toBeVisible();

  await cardB.getByLabel("Close terminal").click();
  await expect(pageA.locator("[data-testid^='terminal-card-']")).toHaveCount(0);
  await expect(pageB.locator("[data-testid^='terminal-card-']")).toHaveCount(0);
  await expect(pageA.getByText("Select a directory to open a terminal")).toBeVisible();
  await expect(pageB.getByText("Select a directory to open a terminal")).toBeVisible();

  await pageA.reload();
  await pageB.reload();

  await openApp(pageA);
  await openApp(pageB);
  await expect(pageA.getByText("Select a directory to open a terminal")).toBeVisible();
  await expect(pageB.getByText("Select a directory to open a terminal")).toBeVisible();
  await expect(pageA.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");
  await expect(pageB.getByTestId("canvas-mode-toggle")).toHaveText("Control Here");

  await contextA.close();
  await contextB.close();
});

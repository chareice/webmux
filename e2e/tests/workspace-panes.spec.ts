import { expect, test } from "@playwright/test";

import {
  listTerminals,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("desktop workspace splits the active terminal into tiled panes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  await page.getByTestId("empty-new-terminal").click();
  await expect(page.getByTestId("expanded-terminal")).toBeVisible();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);

  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  const terminals = await listTerminals(page);
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(2);
  for (const terminal of terminals) {
    await expect(
      page.getByTestId(`expanded-thumb-${terminal.id}`),
    ).toBeVisible();
  }

  await page.getByLabel("Split down").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(3);
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(3);

  await context.close();
});

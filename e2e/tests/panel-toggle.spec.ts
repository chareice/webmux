import { test, expect } from "@playwright/test";
import { openApp, resetMachineState } from "./helpers";

test("Cmd+B toggles the rail", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  await expect(page.getByTestId("rail")).toBeVisible();

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("rail")).toHaveCount(0);

  // Cmd+B toggles the local `railOpen` state only; it isn't persisted
  // across a full page reload, so we expect the rail to come back on its own.
  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("rail")).toBeVisible();

  await context.close();
});

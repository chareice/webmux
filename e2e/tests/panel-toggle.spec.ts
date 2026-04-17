import { test, expect } from "@playwright/test";
import { openApp, resetMachineState } from "./helpers";

test("Cmd+B toggles workpath panel and persists across reload", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  await expect(page.getByTestId("workpath-panel")).toBeVisible();

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("workpath-panel")).toHaveCount(0);

  await page.reload();
  await openApp(page);
  await expect(page.getByTestId("workpath-panel")).toHaveCount(0);

  await page.keyboard.press("Meta+B");
  await expect(page.getByTestId("workpath-panel")).toBeVisible();

  await context.close();
});

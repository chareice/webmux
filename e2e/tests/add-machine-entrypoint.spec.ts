import { test, expect } from "@playwright/test";
import { openApp, resetMachineState } from "./helpers";

test("desktop workbench keeps an add-host entry point after machines exist", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);

  await expect(page.getByTestId("rail-add-machine")).toBeVisible();
  await page.getByTestId("rail-add-machine").click();
  await expect(page.getByTestId("add-machine-dialog")).toBeVisible();
  await expect(page.getByText("Connect a machine")).toBeVisible();

  await page.getByLabel("Close add machine").click();
  await expect(page.getByTestId("add-machine-dialog")).toHaveCount(0);

  await context.close();
});

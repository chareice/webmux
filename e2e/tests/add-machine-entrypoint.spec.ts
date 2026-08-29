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

  // The sidebar's hosts rail lists every machine and carries the add-host
  // button in its header.
  await expect(page.getByTestId("sidebar-host-e2e-node")).toBeVisible();
  await expect(page.getByTestId("sidebar-add-host")).toBeVisible();
  await page.getByTestId("sidebar-add-host").click();
  await expect(page.getByTestId("add-machine-dialog")).toBeVisible();
  await expect(page.getByText("Connect a machine")).toBeVisible();

  await page.getByLabel("Close add machine").click();
  await expect(page.getByTestId("add-machine-dialog")).toHaveCount(0);

  await context.close();
});

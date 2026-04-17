import { test, expect } from "@playwright/test";
import {
  expectTerminalCount,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  openPanel,
  resetMachineState,
} from "./helpers";

test("tab strip: open, switch, close", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  await openPanel(page);
  await page
    .getByTestId("panel-request-control-e2e-node")
    .click()
    .catch(() => {/* already controlled */});

  // Open the ~ workpath; first terminal lands and tab strip shows.
  await page.getByTestId("panel-bookmark-local-home").click();
  await expect(page.getByTestId("tab-strip")).toBeVisible();
  await expectTerminalCount(page, 1);

  const t1 = (await listTerminals(page))[0];
  expect(t1).toBeDefined();

  // Open two more terminals via Cmd+Shift+T → 3 tabs total.
  await page.keyboard.press("Meta+Shift+T");
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  await page.keyboard.press("Meta+Shift+T");
  await expect.poll(async () => (await listTerminals(page)).length).toBe(3);

  const all = await listTerminals(page);
  for (const t of all) {
    await expect(page.getByTestId(`tab-${t.id}`)).toBeVisible();
  }

  // Click the first tab; verify it becomes active.
  await page.getByTestId(`tab-${all[0].id}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Close the active tab; another terminal becomes active.
  await page.getByTestId(`tab-close-${all[0].id}`).click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);

  await context.close();
});

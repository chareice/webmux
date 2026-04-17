import { test, expect } from "@playwright/test";

import {
  openPanel,
  expectTerminalCount,
  getImmersiveTerminal,
  getTerminalCards,
  listTerminals,
  openApp,
  resetMachineState,
} from "./helpers";

test("workpath navigation: create, zoom, back, filter", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  await openApp(page);
  await resetMachineState(page);

  // Initial state — no terminals, Overview header visible.
  await expect(page.getByTestId("overview-header")).toBeVisible();

  // Take control and open a terminal from the "~" bookmark.
  await openPanel(page);
  await page
    .getByTestId("panel-request-control-e2e-node")
    .click()
    .catch(() => {
      /* already controlled — panel hides the button once control is taken */
    });
  await openPanel(page);
  await page.getByTestId("panel-bookmark-local-home").click();

  // After create → zoomed view with tab strip visible
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect(page.getByTestId("tab-strip")).toBeVisible();

  const terminals1 = await listTerminals(page);
  expect(terminals1).toHaveLength(1);
  const t1 = terminals1[0].id;
  expect(page.url()).toContain(`#/t/${t1}`);

  // Back to Overview via panel select-all (mouse-driven navigation)
  await page.getByTestId("panel-select-all").click();
  await expect(page.getByTestId("overview-header")).toBeVisible();
  await expectTerminalCount(page, 1);
  expect(page.url()).not.toContain("#/t/");

  // Zoom into card again
  await getTerminalCards(page).first().click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  expect(page.url()).toContain(`#/t/${t1}`);

  // Back via panel select-all (Esc is consumed by xterm when terminal has focus)
  await page.getByTestId("panel-select-all").click();
  await expect(page.getByTestId("overview-header")).toBeVisible();

  // Create a second terminal in the current workpath via the Overview header
  // "New terminal" button. The first terminal already filled the ~ bookmark,
  // so clicking the bookmark in the overlay would just filter;
  // `overview-new-terminal` is the canonical "add one more here" action and
  // auto-zooms into the new terminal (TERMINAL_CREATED sets zoomedTerminalId).
  await page.getByTestId("overview-new-terminal").click();
  await expect
    .poll(async () => (await listTerminals(page)).length)
    .toBe(2);
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await context.close();
});

import { test, expect } from "@playwright/test";

import {
  closeExpandedOverlay,
  expandOnlyTerminal,
  expectSingleTerminalCard,
  expectTerminalCount,
  getExpandedOverlay,
  getTerminalCards,
  listTerminals,
  openApp,
  resetMachineState,
  selectAllWorkpath,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("grid → expand → sibling thumbnail navigation and URL sync", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  // First terminal via the empty-state CTA (auto-opens the overlay).
  await page.getByTestId("empty-new-terminal").click();
  await expect(getExpandedOverlay(page)).toBeVisible();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);
  const tid1 = (await listTerminals(page))[0].id;
  expect(page.url()).toContain(`#/t/${tid1}`);

  // Close the overlay → back to the grid with a single card.
  await closeExpandedOverlay(page);
  await expectTerminalCount(page, 1);
  expect(page.url()).not.toContain("#/t/");

  // Second terminal via the header button (also auto-opens the overlay).
  await page.getByTestId("workbench-new-terminal").click();
  await expect(getExpandedOverlay(page)).toBeVisible();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  const terminals = await listTerminals(page);
  const tid2 = terminals.find((t) => t.id !== tid1)!.id;
  expect(page.url()).toContain(`#/t/${tid2}`);

  // Thumbnail strip exposes every sibling.
  await expect(page.getByTestId(`expanded-thumb-${tid1}`)).toBeVisible();
  await expect(page.getByTestId(`expanded-thumb-${tid2}`)).toBeVisible();

  // Jump via a sibling thumbnail.
  await page.getByTestId(`expanded-thumb-${tid1}`).click();
  expect(page.url()).toContain(`#/t/${tid1}`);

  // Esc closes the overlay and clears the hash.
  await page.keyboard.press("Escape");
  await expect(getExpandedOverlay(page)).toHaveCount(0);
  expect(page.url()).not.toContain("#/t/");
  await expectTerminalCount(page, 2);

  // "All" scope still shows both terminals.
  await selectAllWorkpath(page);
  await expectTerminalCount(page, 2);

  // Destroy one terminal via the card's close button.
  await page
    .locator(`[data-testid='grid-card-${tid1}']`)
    .getByRole("button", { name: /Close|View only/ })
    .click();
  await expectTerminalCount(page, 1);

  // Reload while the remaining terminal is expanded → overlay is restored.
  await expandOnlyTerminal(page);
  expect(page.url()).toContain(`#/t/${tid2}`);
  await page.reload();
  await openApp(page);
  await expect(getExpandedOverlay(page)).toBeVisible();

  await closeExpandedOverlay(page);
  await expect(getTerminalCards(page)).toHaveCount(1);
  const remaining = await expectSingleTerminalCard(page);
  await expect(remaining).toBeVisible();

  await context.close();
});

import { expect, test, type Page } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  getExpandedOverlay,
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
  const firstId = (await listTerminals(page))[0].id;

  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  const terminals = await listTerminals(page);
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(2);
  for (const terminal of terminals) {
    await expect(
      page.getByTestId(`expanded-thumb-${terminal.id}`),
    ).toBeVisible();
  }

  const secondId = page.url().split("#/t/")[1];
  expect(secondId).toBeTruthy();
  expect(secondId).not.toBe(firstId);
  const firstBox = await paneBox(page, firstId);
  const secondBox = await paneBox(page, secondId);
  expect(secondBox.x).toBeGreaterThan(firstBox.x + firstBox.width * 0.5);
  expect(Math.abs(secondBox.y - firstBox.y)).toBeLessThan(8);
  await expect
    .poll(() => paneTerminalScale(page, secondId), { timeout: 5_000 })
    .toBeGreaterThan(0.95);
  await expect
    .poll(() => paneTerminalScale(page, firstId), { timeout: 5_000 })
    .toBeGreaterThan(0.95);
  await expect
    .poll(async () => {
      const splitTerminal = (await listTerminals(page)).find(
        (terminal) => terminal.id === secondId,
      );
      return splitTerminal?.cols ?? 999;
    }, { timeout: 5_000 })
    .toBeLessThan(140);
  await expect
    .poll(async () => {
      const originalTerminal = (await listTerminals(page)).find(
        (terminal) => terminal.id === firstId,
      );
      return originalTerminal?.cols ?? 999;
    }, { timeout: 5_000 })
    .toBeLessThan(140);
  await expect
    .poll(() => paneXtermScrollbarWidth(page, secondId), { timeout: 5_000 })
    .toBe("none");

  await page.getByLabel("Split down").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(3);
  const afterDown = await listTerminals(page);
  const thirdId = afterDown.find(
    (terminal) => !terminals.some((existing) => existing.id === terminal.id),
  )!.id;
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(3);
  const previousActiveBox = await paneBox(page, secondId);
  const thirdBox = await paneBox(page, thirdId);
  expect(Math.abs(thirdBox.x - previousActiveBox.x)).toBeLessThan(8);
  expect(thirdBox.y).toBeGreaterThan(
    previousActiveBox.y + previousActiveBox.height * 0.5,
  );

  await context.close();
});

test("desktop workspace stays open when closing an inactive pane", async ({
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

  const firstId = await createTerminalViaApi(page);
  await expandTerminalById(page, firstId);
  await expect(getExpandedOverlay(page)).toBeVisible();
  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);

  await page
    .getByTestId(`workspace-pane-${firstId}`)
    .locator("button[title='Close pane']")
    .click();

  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);
  await expect(getExpandedOverlay(page)).toBeVisible();
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(1);
  await expect(page).not.toHaveURL(new RegExp(`#/t/${firstId}$`));

  await context.close();
});

test("desktop workspace hides wterm renderer scrollbars in tiled panes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("webmux:renderer", "wterm");
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const firstId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, firstId);
  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
  const secondId = (await listTerminals(page)).find(
    (terminal) => terminal.id !== firstId,
  )!.id;

  await expect
    .poll(() => paneWtermScrollbarWidth(page, secondId), { timeout: 5_000 })
    .toBe("none");

  await context.close();
});

test("workspace remains mounted when terminal events are delayed", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await page.routeWebSocket(/\/ws\/events/, () => {});
  await page.reload({ waitUntil: "commit" });
  await page
    .getByTestId("workbench-header")
    .waitFor({ state: "visible", timeout: 20_000 });
  await selectHomeWorkpath(page);

  await page.getByTestId("empty-new-terminal").click();

  await expect(getExpandedOverlay(page)).toBeVisible();
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(1);

  await context.close();
});

test("workspace shortcuts focus panes by direction from the terminal", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const firstId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, firstId);
  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(2);

  const secondId = (await listTerminals(page)).find(
    (terminal) => terminal.id !== firstId,
  )!.id;
  await expect(page.getByTestId(`workspace-pane-${secondId}`)).toHaveCSS(
    "box-shadow",
    /rgb/,
  );

  await page.keyboard.press("Control+ArrowLeft");
  await expect(page.getByTestId(`workspace-pane-${firstId}`)).toHaveCSS(
    "box-shadow",
    /rgb/,
  );
  await expect(page.getByTestId(`workspace-pane-${secondId}`)).toHaveCSS(
    "box-shadow",
    "none",
  );

  await page.keyboard.press("Control+ArrowRight");
  await expect(page.getByTestId(`workspace-pane-${secondId}`)).toHaveCSS(
    "box-shadow",
    /rgb/,
  );
});

async function paneBox(page: Page, terminalId: string) {
  const box = await page
    .getByTestId(`workspace-pane-${terminalId}`)
    .boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function paneTerminalScale(page: Page, terminalId: string) {
  const scale = await page
    .getByTestId(`workspace-pane-${terminalId}`)
    .locator("[data-terminal-view-scale]")
    .first()
    .getAttribute("data-terminal-view-scale");
  return Number(scale);
}

async function paneXtermScrollbarWidth(page: Page, terminalId: string) {
  return page
    .getByTestId(`workspace-pane-${terminalId}`)
    .locator(".xterm-viewport")
    .first()
    .evaluate((element) => getComputedStyle(element).scrollbarWidth);
}

async function paneWtermScrollbarWidth(page: Page, terminalId: string) {
  return page
    .getByTestId(`workspace-pane-${terminalId}`)
    .locator(".wterm")
    .first()
    .evaluate((element) => getComputedStyle(element).scrollbarWidth);
}

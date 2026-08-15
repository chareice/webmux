import { expect, test, type Page } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  openApp,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

// Touch devices always get the single-column mobile layout, folded or not:
// the touch-workspace experiment routed the unfolded inner screen to the
// desktop chrome, but real-device use showed the mobile layout works better
// there too (splits got cramped, the soft keyboard fought the multi-pane
// grid). These specs pin the classification for both Fold screens.

const UNFOLDED = {
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  viewport: { width: 757, height: 790 },
  screen: { width: 757, height: 840 },
};

const COVER = {
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  viewport: { width: 384, height: 780 },
  screen: { width: 384, height: 832 },
};

test.use(UNFOLDED);

async function assertCoarsePointer(page: Page): Promise<void> {
  const state = await page.evaluate(() => ({
    coarse: window.matchMedia("(pointer: coarse)").matches,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    innerWidth: window.innerWidth,
  }));
  expect(
    state.coarse,
    `expected (pointer: coarse) under Fold touch emulation; got ${JSON.stringify(state)}`,
  ).toBe(true);
}

async function emulateScreen(
  page: Page,
  metrics: {
    width: number;
    height: number;
    screenWidth: number;
    screenHeight: number;
  },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: metrics.width,
    height: metrics.height,
    screenWidth: metrics.screenWidth,
    screenHeight: metrics.screenHeight,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
}

test.describe("Fold inner screen (large + touch)", () => {
  test("shows the mobile workbench, not the desktop chrome", async ({
    page,
  }) => {
    await assertCoarsePointer(page);
    await openApp(page);
    await resetMachineState(page);

    await expect(page.getByTestId("mobile-workbench")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);

    await requestMachineControl(page);
    const terminalId = await createTerminalViaApi(page);
    await expandTerminalById(page, terminalId);
    await expect(
      page.getByTestId(`workspace-pane-${terminalId}`),
    ).toBeVisible();
  });

  test("fold to cover and back keeps the mobile layout and active terminal", async ({
    page,
  }) => {
    await assertCoarsePointer(page);
    await openApp(page);
    await resetMachineState(page);
    await requestMachineControl(page);
    const terminalId = await createTerminalViaApi(page);
    await expandTerminalById(page, terminalId);
    await expect(page.getByTestId("mobile-workbench")).toBeVisible();
    await expect(
      page.getByTestId(`workspace-pane-${terminalId}`),
    ).toBeVisible();

    await emulateScreen(page, {
      width: COVER.viewport.width,
      height: COVER.viewport.height,
      screenWidth: COVER.screen.width,
      screenHeight: COVER.screen.height,
    });
    await expect(page.getByTestId("mobile-workbench")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
    await expect(
      page.getByTestId(`workspace-pane-${terminalId}`),
    ).toBeVisible();

    await emulateScreen(page, {
      width: UNFOLDED.viewport.width,
      height: UNFOLDED.viewport.height,
      screenWidth: UNFOLDED.screen.width,
      screenHeight: UNFOLDED.screen.height,
    });
    await expect(page.getByTestId("mobile-workbench")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
    await expect(
      page.getByTestId(`workspace-pane-${terminalId}`),
    ).toBeVisible();
  });
});

test.describe("Fold cover screen (compact + touch)", () => {
  test.use(COVER);

  test("shows the mobile workbench instead of the tab bar", async ({ page }) => {
    await assertCoarsePointer(page);
    await openApp(page);
    await expect(page.getByTestId("mobile-workbench")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  });
});

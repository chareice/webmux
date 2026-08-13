import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createTerminalViaApi,
  createWorkspaceGroupViaApi,
  expandTerminalById,
  listTerminals,
  openApp,
  openPaneContextMenu,
  readTerminalBuffer,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

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

/**
 * Long-press via mouse-driven pointer events.
 *
 * The tracker is gated on display-mode `isTouch`, not on `pointerType`, so
 * Playwright's mouse down/hold/up path fires it. `page.touchscreen` has no
 * hold, and synthesizing TouchEvents would skip the Pointer Event listeners
 * the helper actually uses.
 */
async function longPress(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "long-press target must be visible").toBeTruthy();
  const x = box!.x + Math.min(24, box!.width / 2);
  const y = box!.y + Math.min(12, box!.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
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

  test("shows desktop chrome and portals the key bar into the workspace slot", async ({
    page,
  }) => {
    const commandFrames: string[] = [];
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/ws/terminal/")) return;
      socket.on("framesent", (frame) => {
        if (typeof frame.payload !== "string") return;
        const payload = JSON.parse(frame.payload) as {
          type: string;
          data?: string;
        };
        if (payload.type === "command_input" && payload.data) {
          commandFrames.push(payload.data);
        }
      });
    });

    await assertCoarsePointer(page);
    await openApp(page);
    await resetMachineState(page);

    await expect(page.getByTestId("tab-bar")).toBeVisible();
    await expect(page.getByTestId("mobile-workbench")).toHaveCount(0);

    await requestMachineControl(page);
    const terminalId = await createTerminalViaApi(page);
    await expandTerminalById(page, terminalId);
    await expect(
      page.getByTestId(`workspace-pane-${terminalId}`),
    ).toBeVisible();

    const slot = page.getByTestId("workspace-keybar-slot");
    await expect(slot.getByTestId("extended-keybar-esc")).toBeVisible();

    // Key-bar taps go through the lazy-loaded TerminalView's ref and are
    // dropped while it is still mounting (same as the phone shell). Wait for
    // the shell prompt to reach the xterm buffer — that proves the view is
    // mounted and the attach socket is live — before asserting on taps.
    await expect
      .poll(async () => (await readTerminalBuffer(page, terminalId)).trim(), {
        timeout: 15_000,
      })
      .not.toBe("");

    commandFrames.length = 0;
    await slot.getByTestId("extended-keybar-esc").click();
    await expect.poll(() => commandFrames).toContain("\x1b");
    await slot.getByRole("button", { name: "/", exact: true }).click();
    await expect.poll(() => commandFrames).toContain("/");
    await expect
      .poll(() => readTerminalBuffer(page, terminalId), { timeout: 10_000 })
      .toContain("/");
    await expect(slot.getByTestId("extended-keybar-esc")).toBeVisible();
  });

  test("long-press opens the pane and tab context menus", async ({ page }) => {
    await assertCoarsePointer(page);
    await openApp(page);
    await resetMachineState(page);
    await requestMachineControl(page);

    const group = await createWorkspaceGroupViaApi(
      page,
      `Fold Tab ${Date.now()}`,
    );
    const firstId = await createTerminalViaApi(page, {
      cwd: "/root",
      workspaceGroupId: group.id,
    });
    await expandTerminalById(page, firstId);

    await openPaneContextMenu(page, firstId);
    await page.getByRole("button", { name: "Split right" }).click();
    await expect.poll(async () => (await listTerminals(page)).length).toBe(2);
    await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(
      2,
    );
    const secondId = (await listTerminals(page)).find(
      (terminal) => terminal.id !== firstId,
    )!.id;

    // Touch workspaces render every split stacked as a single column, even
    // though "Split right" persists a horizontal split for desktop clients:
    // both panes keep the full viewport width and the new pane sits below.
    const firstBox = (await page
      .getByTestId(`workspace-pane-${firstId}`)
      .boundingBox())!;
    const secondBox = (await page
      .getByTestId(`workspace-pane-${secondId}`)
      .boundingBox())!;
    expect(firstBox.width).toBeGreaterThan(UNFOLDED.viewport.width * 0.9);
    expect(secondBox.width).toBeGreaterThan(UNFOLDED.viewport.width * 0.9);
    expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height - 5);

    await longPress(page, page.getByTestId(`workspace-pane-${secondId}`));
    const paneMenu = page.getByTestId("context-menu");
    await expect(paneMenu).toBeVisible();
    await expect(paneMenu.getByRole("button", { name: "Split right" })).toBeVisible();
    await expect(paneMenu.getByRole("button", { name: "Close pane" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(paneMenu).toHaveCount(0);

    await longPress(page, page.getByTestId(`workspace-tab-${group.id}`));
    const tabMenu = page.getByTestId("context-menu");
    await expect(tabMenu).toBeVisible();
    await expect(tabMenu.getByRole("button", { name: "Rename tab" })).toBeVisible();
    await expect(
      tabMenu.getByRole("button", { name: `Delete tab "${group.name}"` }),
    ).toBeVisible();
  });

  test("fold to cover and back keeps the same terminal active", async ({
    page,
  }) => {
    await assertCoarsePointer(page);
    await openApp(page);
    await resetMachineState(page);
    await requestMachineControl(page);
    const terminalId = await createTerminalViaApi(page);
    await expandTerminalById(page, terminalId);
    await expect(page.getByTestId("tab-bar")).toBeVisible();
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
    await expect(page.getByTestId("tab-bar")).toBeVisible();
    await expect(page.getByTestId("mobile-workbench")).toHaveCount(0);
    await expect(
      page.getByTestId(`workspace-pane-${terminalId}`),
    ).toBeVisible();
  });
});

test.describe("Fold cover screen (compact + touch)", () => {
  test.use(COVER);

  test("shows the mobile workbench instead of the tab bar", async ({ page }) => {
    await assertCoarsePointer(page);
    const screen = await page.evaluate(() => ({
      width: window.screen.width,
      height: window.screen.height,
    }));
    expect(
      Math.min(screen.width, screen.height),
      `cover short edge should stay under 600; got ${JSON.stringify(screen)}`,
    ).toBeLessThan(600);

    await openApp(page);
    await expect(page.getByTestId("mobile-workbench")).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  });
});

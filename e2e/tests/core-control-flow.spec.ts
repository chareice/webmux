import { test, expect, type Page } from "@playwright/test";

import {
  expectControlState,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("desktop control handoff stays in sync across browser sessions", async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await openApp(pageA);
  await resetMachineState(pageA);

  // Session A starts viewing. Take control and create a terminal via the
  // empty-state CTA.
  await expectControlState(pageA, "viewing");
  await takeControlFromHeader(pageA);
  await selectHomeWorkpath(pageA);
  await pageA.getByTestId("empty-new-terminal").click();

  // The workspace is now the main view. Session A is controller.
  await pageA.getByTestId("expanded-terminal").waitFor({ state: "visible" });
  // Open the pane's context menu and read the Close pane item's enabled
  // state; dismiss the menu again with Escape.
  const getCloseItemState = async (page: Page) => {
    await page
      .locator("[data-testid^='workspace-pane-']")
      .first()
      .click({ button: "right" });
    const item = page.getByRole("button", { name: "Close pane" });
    await expect(item).toBeVisible();
    const enabled = await item.isEnabled();
    return { item, enabled };
  };
  const dismissMenu = async (page: Page) => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
  };

  await expect.poll(async () => (await getCloseItemState(pageA)).enabled).toBe(true);
  await dismissMenu(pageA);

  // Session B arrives in view-only mode with the workspace already visible.
  await openApp(pageB);
  await expectControlState(pageB, "viewing");
  await pageB.getByTestId("expanded-terminal").waitFor({ state: "visible" });
  await expect.poll(async () => (await getCloseItemState(pageB)).enabled).toBe(false);
  await dismissMenu(pageB);

  // Handoff: B takes control, A flips to viewing.
  await takeControlFromHeader(pageB);
  await expect.poll(async () => (await getCloseItemState(pageB)).enabled).toBe(true);

  await expectControlState(pageA, "viewing");
  // B closes the terminal from the same context menu.
  await (await getCloseItemState(pageB)).item.click();
  await expect(pageA.getByText(/No terminals/)).toBeVisible();
  await expect(pageB.getByText(/No terminals/)).toBeVisible();

  // Reload: A never had control (stays "viewing"), B had control
  // (auto-restored via the hub's WS-disconnect grace period).
  await pageA.reload();
  await pageB.reload();
  await pageA.getByTestId("tab-bar").waitFor({ state: "visible", timeout: 20_000 });
  await pageB.getByTestId("tab-bar").waitFor({ state: "visible", timeout: 20_000 });
  await expectControlState(pageA, "viewing");
  await expectControlState(pageB, "controlling");
  // Positive controller signal: the empty-state CTA only renders for the
  // controller, so this also proves the lease was restored, not just that
  // the pill hasn't appeared yet.
  await expect(pageB.getByTestId("empty-new-terminal")).toBeVisible();

  await contextA.close();
  await contextB.close();
});

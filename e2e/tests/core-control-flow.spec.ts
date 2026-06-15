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
  const getCloseBtn = (page: Page) =>
    page.locator("[data-testid^='expanded-thumb-close-']").first();
  const closeBtnA = getCloseBtn(pageA);
  await expect(closeBtnA).toBeEnabled();

  // Session B arrives in view-only mode with the workspace already visible.
  await openApp(pageB);
  await expectControlState(pageB, "viewing");
  await pageB.getByTestId("expanded-terminal").waitFor({ state: "visible" });
  const closeBtnB = getCloseBtn(pageB);
  await expect(closeBtnB).toBeDisabled();

  // Handoff: B takes control, A flips to viewing.
  await takeControlFromHeader(pageB);
  await expect(closeBtnB).toBeEnabled();

  await expectControlState(pageA, "viewing");
  await expect(closeBtnA).toBeDisabled();

  // Destroying from B removes the terminal everywhere.
  await closeBtnB.click();
  await expect(pageA.getByText(/No terminals/)).toBeVisible();
  await expect(pageB.getByText(/No terminals/)).toBeVisible();

  // Reload: A never had control (stays "Control Here"), B had control
  // (auto-restored via the hub's WS-disconnect grace period).
  await pageA.reload();
  await pageB.reload();
  await pageA.getByTestId("workbench-header").waitFor({ state: "visible", timeout: 20_000 });
  await pageB.getByTestId("workbench-header").waitFor({ state: "visible", timeout: 20_000 });
  await expectControlState(pageA, "viewing");
  await expectControlState(pageB, "controlling");

  await contextA.close();
  await contextB.close();
});

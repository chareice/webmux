import { test, expect } from "@playwright/test";

import {
  expectControlState,
  openApp,
  pressPrefixKey,
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

  // The workspace is now the main view. Session A is controller: the
  // control-gated sidebar action is enabled for it.
  await pageA.getByTestId("expanded-terminal").waitFor({ state: "visible" });
  await expect(pageA.getByTestId("sidebar-new-tab")).toBeEnabled();

  // Session B arrives in view-only mode with the workspace already visible;
  // the same gated action is disabled for it.
  await openApp(pageB);
  await expectControlState(pageB, "viewing");
  await pageB.getByTestId("expanded-terminal").waitFor({ state: "visible" });
  await expect(pageB.getByTestId("sidebar-new-tab")).toBeDisabled();

  // Handoff: B takes control, A flips to viewing and its gated action
  // disables; B's enables.
  await takeControlFromHeader(pageB);
  await expect(pageB.getByTestId("sidebar-new-tab")).toBeEnabled();
  await expectControlState(pageA, "viewing");
  await expect(pageA.getByTestId("sidebar-new-tab")).toBeDisabled();

  // B closes the terminal through the real ⌃B x prefix path (idle shell:
  // no foreground process, so no confirm dialog).
  await pageB.locator("[data-testid^='workspace-pane-']").first().click();
  await pressPrefixKey(pageB, "x");
  await expect(pageA.getByText(/No terminals/)).toBeVisible();
  await expect(pageB.getByText(/No terminals/)).toBeVisible();

  // Reload: A never had control (stays "viewing"), B had control
  // (auto-restored via the hub's WS-disconnect grace period).
  await pageA.reload();
  await pageB.reload();
  await pageA.getByTestId("sidebar").waitFor({ state: "visible", timeout: 20_000 });
  await pageB.getByTestId("sidebar").waitFor({ state: "visible", timeout: 20_000 });
  await expectControlState(pageA, "viewing");
  await expectControlState(pageB, "controlling");
  // Positive controller signal: the empty-state CTA only renders for the
  // controller, so this also proves the lease was restored, not just that
  // the pill hasn't appeared yet.
  await expect(pageB.getByTestId("empty-new-terminal")).toBeVisible();

  await contextA.close();
  await contextB.close();
});

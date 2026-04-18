import { test, expect } from "@playwright/test";

import {
  closeExpandedOverlay,
  expectSingleTerminalCard,
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
  // empty-state CTA (which scopes the new terminal to the selected workpath).
  await expectControlState(pageA, "viewing");
  await takeControlFromHeader(pageA);
  await selectHomeWorkpath(pageA);
  await pageA.getByTestId("empty-new-terminal").click();

  // Creating a terminal auto-zooms; dismiss the overlay so we can verify the
  // grid card state for both sessions.
  await closeExpandedOverlay(pageA);
  const cardA = await expectSingleTerminalCard(pageA);
  await expect(cardA.getByRole("button", { name: "Close terminal" })).toBeEnabled();

  // Session B arrives in view-only mode with the shared card already visible.
  await openApp(pageB);
  await expectControlState(pageB, "viewing");
  const cardB = await expectSingleTerminalCard(pageB);
  const closeBtnB = cardB.getByRole("button", { name: /Close|View only/ });
  await expect(closeBtnB).toBeDisabled();

  // Handoff: B takes control, A flips to viewing.
  await takeControlFromHeader(pageB);
  await expect(cardB.getByRole("button", { name: "Close terminal" })).toBeEnabled();

  await expectControlState(pageA, "viewing");
  const closeBtnA = cardA.getByRole("button", { name: /Close|View only/ });
  await expect(closeBtnA).toBeDisabled();

  // Destroying from B removes the card everywhere.
  await cardB.getByRole("button", { name: "Close terminal" }).click();
  await expect(pageA.getByText(/No terminals/)).toBeVisible();
  await expect(pageB.getByText(/No terminals/)).toBeVisible();

  // Reload: A never had control (stays "Control Here"), B had control
  // (auto-restored via the pending-control-release recovery on boot).
  await pageA.reload();
  await pageB.reload();
  await openApp(pageA);
  await openApp(pageB);
  await expectControlState(pageA, "viewing");
  await expectControlState(pageB, "controlling");

  await contextA.close();
  await contextB.close();
});

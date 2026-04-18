import { expect, test, devices } from "@playwright/test";

import {
  closeExpandedOverlay,
  createTerminalViaApi,
  expandOnlyTerminal,
  expandTerminalById,
  expectControlState,
  expectTerminalCount,
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
  getTerminalCards,
  getTerminalViewJustify,
  getTerminalViewScale,
  listTerminals,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("mobile viewing stays readable when desktop explicitly sizes the shared terminal", async ({
  browser,
}) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const mobile = await browser.newContext({
    ...devices["iPhone 14"],
    browserName: "chromium",
  });
  const desktopPage = await desktop.newPage();
  const mobilePage = await mobile.newPage();

  await openApp(desktopPage);
  await resetMachineState(desktopPage);
  await takeControlFromHeader(desktopPage);
  await selectHomeWorkpath(desktopPage);
  const tid = await createTerminalViaApi(desktopPage, { cwd: "/root" });
  await expandTerminalById(desktopPage, tid);
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();

  // Wait for auto-fit to push the terminal past the 80x24 defaults.
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(desktopPage);
      return terminal?.cols ?? 0;
    })
    .toBeGreaterThan(80);

  const [desktopSizedTerminal] = await listTerminals(desktopPage);
  expect(desktopSizedTerminal).toBeDefined();

  await openApp(mobilePage);
  await expect.poll(async () => (await listTerminals(mobilePage)).length).toBe(1);

  // Mobile is in view-only mode — tap the card to open the fullscreen
  // mobile terminal view (ExpandedTerminal in isMobile mode).
  const mobileCard = mobilePage.locator("[data-testid^='grid-card-']:visible, [data-testid^='mobile-term-card-']").first();
  await expect(mobileCard).toBeVisible();
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  // In view-only mode the mobile terminal toolbar is absent: no control
  // toggle, no fit button, no keyboard toggle.
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveCount(0);
  await expect(mobilePage.getByTestId("terminal-fit-button")).toHaveCount(0);
  await expect(mobilePage.getByTitle("Show keyboard")).toHaveCount(0);

  await expect
    .poll(async () => getTerminalViewScale(mobilePage))
    .toBeLessThan(1);
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([desktopSizedTerminal]);

  await desktop.close();
  await mobile.close();
});

test("terminal auto-fits to whichever device currently holds control", async ({
  browser,
}) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const mobile = await browser.newContext({
    ...devices["iPhone 14"],
    browserName: "chromium",
  });
  const desktopPage = await desktop.newPage();
  const mobilePage = await mobile.newPage();

  await openApp(desktopPage);
  await resetMachineState(desktopPage);
  await takeControlFromHeader(desktopPage);
  await selectHomeWorkpath(desktopPage);
  const tid = await createTerminalViaApi(desktopPage, { cwd: "/root" });
  await expandTerminalById(desktopPage, tid);

  // Desktop controller → terminal auto-fits to desktop dims.
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(desktopPage);
      return terminal?.cols ?? 0;
    })
    .toBeGreaterThan(80);
  const [desktopSizedTerminal] = await listTerminals(desktopPage);
  expect(desktopSizedTerminal).toBeDefined();

  await openApp(mobilePage);
  // Tap the mobile card → opens fullscreen overlay.
  const mobileCard = mobilePage.locator("[data-testid^='grid-card-']:visible, [data-testid^='mobile-term-card-']").first();
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  // Mobile takes control via the in-terminal toggle.
  await mobilePage.getByTestId("terminal-mode-toggle").click();
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "Stop Control",
  );
  // Desktop header flips to view-only (overlay is still open, so the header
  // isn't visible — close the overlay first to check, then re-open).
  await closeExpandedOverlay(desktopPage);
  await expectControlState(desktopPage, "viewing");

  // Mobile takes control → terminal auto-fits to mobile dims.
  let mobileSizedTerminal = desktopSizedTerminal;
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(mobilePage);
      mobileSizedTerminal = terminal;
      return terminal;
    })
    .not.toEqual(desktopSizedTerminal);

  // Desktop re-opens the overlay and sees the narrower terminal centred.
  await expandOnlyTerminal(desktopPage);
  await expect
    .poll(async () => getTerminalViewJustify(desktopPage))
    .toBe("center");
  await expect
    .poll(async () => getTerminalViewScale(desktopPage))
    .toBe(1);

  // Hand control back to desktop. Close the desktop overlay, press the
  // header toggle, then re-open.
  await closeExpandedOverlay(desktopPage);
  await desktopPage.getByTestId("workbench-request-control").click();
  await expect(desktopPage.getByTestId("workbench-stop-control")).toBeVisible();
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "Control Here",
  );
  await getTerminalCards(desktopPage).first().click();
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();

  // Desktop is controller again → terminal auto-fits back to desktop dims.
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(desktopPage);
      return terminal;
    })
    .not.toEqual(mobileSizedTerminal);
  await expect
    .poll(async () => getTerminalViewScale(mobilePage))
    .toBeLessThan(1);

  await desktop.close();
  await mobile.close();
});

test("multiple shared terminals stay in sync across mobile handoff and selective close", async ({
  browser,
}) => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const mobile = await browser.newContext({
    ...devices["iPhone 14"],
    browserName: "chromium",
  });
  const desktopPage = await desktop.newPage();
  const mobilePage = await mobile.newPage();

  await openApp(desktopPage);
  await resetMachineState(desktopPage);
  await takeControlFromHeader(desktopPage);

  await createTerminalViaApi(desktopPage, { cwd: "/root" });
  await createTerminalViaApi(desktopPage, { cwd: "/root" });

  await expect
    .poll(async () => (await listTerminals(desktopPage)).length)
    .toBe(2);

  const initialTerminalIds = (await listTerminals(desktopPage))
    .map((terminal) => terminal.id)
    .sort();

  await expectTerminalCount(desktopPage, 2);
  await openApp(mobilePage);
  await expect.poll(async () => (await listTerminals(mobilePage)).length).toBe(2);

  // Mobile takes control via API (avoid UI overlap fights).
  const mobileHeaders = await getAuthHeaders(mobilePage);
  const mobileDeviceId = await getDeviceId(mobilePage);
  await mobilePage.request.post("/api/mode/control", {
    headers: mobileHeaders,
    data: { machine_id: "e2e-node", device_id: mobileDeviceId },
  });
  await expectControlState(desktopPage, "viewing");

  // Mobile closes one terminal via API.
  const mobileTerminals = await listTerminals(mobilePage);
  await mobilePage.request.delete(
    `/api/machines/${mobileTerminals[0].machine_id}/terminals/${mobileTerminals[0].id}?device_id=${encodeURIComponent(mobileDeviceId)}`,
    { headers: mobileHeaders },
  );
  await expect.poll(async () => (await listTerminals(mobilePage)).length).toBe(1);
  await expect.poll(async () => (await listTerminals(desktopPage)).length).toBe(1);

  const remainingDesktopTerminals = await listTerminals(desktopPage);
  const remainingMobileTerminals = await listTerminals(mobilePage);
  expect(remainingDesktopTerminals).toEqual(remainingMobileTerminals);
  expect(remainingDesktopTerminals).toHaveLength(1);
  expect(initialTerminalIds).toContain(remainingDesktopTerminals[0]?.id);

  await desktop.close();
  await mobile.close();
});

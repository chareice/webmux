import { expect, test, devices } from "@playwright/test";

import {
  createTerminalViaApi,
  expandOnlyTerminal,
  expandTerminalById,
  expectControlState,
  expectTerminalCount,
  fitPaneViaContextMenu,
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
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

  await fitPaneViaContextMenu(desktopPage, tid);

  // Explicit desktop fit pushes the terminal past the 80x24 defaults.
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
  const mobileCard = mobilePage.locator("[data-testid^='mobile-term-card-']:visible").first();
  await expect(mobileCard).toBeVisible();
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  // In view-only mode the mobile terminal toolbar surfaces only the control
  // toggle (so the viewer can take over) — the controller-only affordances
  // (fit button and keyboard toggle) are absent.
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "control",
  );
  await expect(mobilePage.getByTestId("terminal-fit-button")).toHaveCount(0);
  await expect(mobilePage.getByTitle("Show keyboard")).toHaveCount(0);

  await expect
    .poll(async () => getTerminalViewScale(mobilePage))
    .toBe(1);
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([desktopSizedTerminal]);

  await desktop.close();
  await mobile.close();
});

test("terminal can be manually fitted by whichever device currently holds control", async ({
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

  // Desktop controller → terminal fits to desktop dims when requested.
  await fitPaneViaContextMenu(desktopPage, tid);
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
  const mobileCard = mobilePage.locator("[data-testid^='mobile-term-card-']:visible").first();
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  // Mobile takes control via the header pill.
  await mobilePage.getByTestId("terminal-mode-toggle").click();
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "ctrl",
  );
  // Desktop flips to view-only — the TabBar's viewing pill appears.
  await expectControlState(desktopPage, "viewing");

  // Mobile takes control → terminal fits to mobile dims when requested.
  await mobilePage.getByTestId("terminal-fit-button").click();
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

  // Hand control back to desktop via the TabBar's viewing pill.
  await desktopPage.getByTestId("workbench-request-control").click();
  await expect(desktopPage.getByTestId("workbench-request-control")).toHaveCount(0);
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "control",
  );
  await expandOnlyTerminal(desktopPage);
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();

  // Desktop is controller again → terminal fits back to desktop dims when requested.
  await fitPaneViaContextMenu(desktopPage, tid);
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(desktopPage);
      return terminal;
    })
    .not.toEqual(mobileSizedTerminal);
  await expect
    .poll(async () => getTerminalViewScale(mobilePage))
    .toBe(1);

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

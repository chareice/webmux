import { expect, test, devices } from "@playwright/test";

import {
  closeExpandedOverlay,
  createTerminalViaApi,
  expandOnlyTerminal,
  expandTerminalById,
  expectSingleTerminalCard,
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("terminal size stays stable across overlay and cross-device handoff until fit is requested", async ({
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

  // Open the terminal in the ExpandedTerminal overlay.
  await expandTerminalById(desktopPage, tid);
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();

  // Wait for auto-fit to settle (runs ~200ms after opening for newly created
  // terminals) — cols/rows move off the 80x24 defaults, then stabilize.
  let initialTerminal: Awaited<ReturnType<typeof listTerminals>>[number] | null = null;
  await expect.poll(async () => {
    const terminals = await listTerminals(desktopPage);
    if (terminals.length !== 1) return false;
    if (terminals[0].cols === 80 && terminals[0].rows === 24) return false;
    initialTerminal = terminals[0];
    return true;
  }).toBe(true);
  expect(initialTerminal).not.toBeNull();

  await expect
    .poll(async () => listTerminals(desktopPage))
    .toEqual([initialTerminal]);

  // Mobile viewer: the terminal appears in the "Terminals" tab's mobile card
  // list. Tap it to open the fullscreen focus view (which on mobile uses the
  // same ExpandedTerminal component in full-bleed mode, then renders the
  // immersive TerminalCard inside).
  await openApp(mobilePage);
  const mobileCard = await expectSingleTerminalCard(mobilePage);
  // On mobile the grid card IS the MobileTermCard — tapping it dispatches
  // ZOOM_TERMINAL and opens the overlay.
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  // Server pty size is still at desktop dims — asserted inside the auto-fit
  // debounce window so no fit message has reached the server yet.
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([initialTerminal]);
  await expect
    .poll(async () =>
      Number(
        await getImmersiveTerminal(mobilePage).getAttribute("data-terminal-view-scale"),
      ),
    )
    .toBeLessThan(1);

  // Mobile viewer cannot resize without control — no fit button is visible.
  await expect(mobilePage.getByTestId("terminal-fit-button")).toHaveCount(0);

  await mobile.close();
  await desktop.close();
});

test("mobile controller can resize the shared pty with Fit to Window", async ({
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

  // Wait for desktop auto-fit to settle.
  let desktopInitial: Awaited<ReturnType<typeof listTerminals>>[number] | null = null;
  await expect.poll(async () => {
    const terminals = await listTerminals(desktopPage);
    if (terminals.length !== 1) return false;
    if (terminals[0].cols === 80 && terminals[0].rows === 24) return false;
    desktopInitial = terminals[0];
    return true;
  }).toBe(true);

  // Mobile opens same terminal; desktop releases control so mobile can fit.
  await openApp(mobilePage);
  const mobileCard = await expectSingleTerminalCard(mobilePage);
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  // Desktop releases, mobile takes control via the in-terminal toggle.
  await closeExpandedOverlay(desktopPage);
  await desktopPage.getByTestId("workbench-stop-control").click();
  await expect(desktopPage.getByTestId("workbench-request-control")).toBeVisible();

  await mobilePage.getByTestId("terminal-mode-toggle").click();
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText("Stop Control");

  // Fit to mobile viewport → server cols/rows shrink.
  await mobilePage.getByTestId("terminal-fit-button").click();
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(mobilePage);
      return terminal;
    })
    .not.toEqual(desktopInitial);

  // Desktop re-opens the overlay and sees the narrower terminal centred.
  await expandOnlyTerminal(desktopPage);
  await expect
    .poll(async () =>
      await getImmersiveTerminal(desktopPage).getAttribute("data-terminal-view-justify"),
    )
    .toBe("center");
  await expect
    .poll(async () =>
      Number(
        await getImmersiveTerminal(desktopPage).getAttribute("data-terminal-view-scale"),
      ),
    )
    .toBe(1);

  // Clean up via API — mobile holds control.
  const mobileHeaders = await getAuthHeaders(mobilePage);
  const mobileDeviceId = await getDeviceId(mobilePage);
  for (const t of await listTerminals(mobilePage)) {
    await mobilePage.request.delete(
      `/api/machines/${t.machine_id}/terminals/${t.id}?device_id=${encodeURIComponent(mobileDeviceId)}`,
      { headers: mobileHeaders },
    );
  }
  await expect.poll(async () => listTerminals(mobilePage)).toEqual([]);

  await desktop.close();
  await mobile.close();
});

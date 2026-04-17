import { expect, test, devices } from "@playwright/test";

import {
  expectSingleTerminalCard,
  openPanel,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  resetMachineState,
  getAuthHeaders,
  getDeviceId,
} from "./helpers";

test("terminal size stays stable across tab view and cross-device handoff until fit is requested", async ({
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
  await openPanel(desktopPage);
  await desktopPage.getByTestId("panel-request-control-e2e-node").click();
  await openPanel(desktopPage);
  await desktopPage.getByTestId("panel-bookmark-local-home").click();

  // After creating a terminal, it auto-switches to tab (immersive) view
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();

  // Wait for auto-fit to settle (runs ~200ms after tab switch for newly created terminals)
  let initialTerminal: Awaited<ReturnType<typeof listTerminals>>[number] | null = null;
  await expect.poll(async () => {
    const terminals = await listTerminals(desktopPage);
    if (terminals.length !== 1) return false;
    // Auto-fit changes size from defaults (80x24); wait until it stabilizes
    if (terminals[0].cols === 80 && terminals[0].rows === 24) return false;
    initialTerminal = terminals[0];
    return true;
  }).toBe(true);
  expect(initialTerminal).not.toBeNull();

  // Size should stay stable after auto-fit
  await expect
    .poll(async () => listTerminals(desktopPage))
    .toEqual([initialTerminal]);

  await openApp(mobilePage);
  // Terminal shows in grid (card mode) for mobile viewer, click to open tab
  const mobileCard = await expectSingleTerminalCard(mobilePage);
  await mobilePage.getByTestId("statusbar-mode-toggle").click();
  await mobileCard.click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();
  // Verify the server-side pty size is still at desktop dims — checked here,
  // before waiting for the viewport-layout to settle, to ensure the assertion
  // runs inside the 200ms auto-fit debounce window (before any auto-fit
  // message can reach the server).
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([initialTerminal]);
  // Terminal at desktop dims is larger than the mobile viewport, so the client
  // scales it down to fit — confirm the scale is < 1.
  await expect
    .poll(async () =>
      Number(
        await getImmersiveTerminal(mobilePage).getAttribute("data-terminal-view-scale"),
      ),
    )
    .toBeLessThan(1);

  await mobilePage.getByTestId("terminal-fit-button").click();

  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(mobilePage);
      return terminal;
    })
    .not.toEqual(initialTerminal);
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

  // Clean up via API — the mobile controller holds control and there is no
  // accessible close button while the terminal is in immersive tab mode.
  const mobileHeaders = await getAuthHeaders(mobilePage);
  const mobileDeviceId = await getDeviceId(mobilePage);
  const terminalsToClose = await listTerminals(mobilePage);
  for (const t of terminalsToClose) {
    await mobilePage.request.delete(
      `/api/machines/${t.machine_id}/terminals/${t.id}?device_id=${encodeURIComponent(mobileDeviceId)}`,
      { headers: mobileHeaders },
    );
  }
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([]);

  await desktop.close();
  await mobile.close();
});

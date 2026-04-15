import { expect, test, devices } from "@playwright/test";

import {
  expectGlobalModeToggleLabel,
  expectTerminalCount,
  expandMachineSection,
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
  getTerminalCards,
  getTerminalViewJustify,
  getTerminalViewScale,
  listTerminals,
  maximizeOnlyTerminal,
  openApp,
  openRootBookmark,
  resetMachineState,
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
  await expandMachineSection(desktopPage);
  await desktopPage.getByTestId("machine-request-control-e2e-node").click();
  await openRootBookmark(desktopPage);
  // Terminal auto-switches to tab view after creation
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();
  await desktopPage.getByTestId("terminal-fit-button").click();

  const [desktopSizedTerminal] = await listTerminals(desktopPage);
  expect(desktopSizedTerminal).toBeDefined();

  await openApp(mobilePage);
  // Wait for terminal to sync
  await expect.poll(async () => (await listTerminals(mobilePage)).length).toBe(1);
  // On mobile, click the terminal's tab directly to enter immersive view
  // (the hamburger button overlaps tab-all on mobile, so avoid going through grid)
  const mobileTerminals = await listTerminals(mobilePage);
  await mobilePage.getByTestId(`tab-${mobileTerminals[0].id}`).click();
  await expect(getImmersiveTerminal(mobilePage)).toBeVisible();

  await expectGlobalModeToggleLabel(mobilePage, "Control Here");
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "Control Here",
  );
  await expect(mobilePage.getByTestId("terminal-fit-button")).toHaveCount(0);
  await expect(mobilePage.getByTitle("Show command bar")).toBeDisabled();
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

test("explicit terminal sizing can round-trip between desktop and mobile without surprise resizes", async ({
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
  await expandMachineSection(desktopPage);
  await desktopPage.getByTestId("machine-request-control-e2e-node").click();
  await openRootBookmark(desktopPage);
  // Terminal auto-switches to tab view after creation
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();
  await desktopPage.getByTestId("terminal-fit-button").click();

  const [desktopSizedTerminal] = await listTerminals(desktopPage);
  expect(desktopSizedTerminal).toBeDefined();

  await openApp(mobilePage);
  await maximizeOnlyTerminal(mobilePage);
  await mobilePage.getByTestId("terminal-mode-toggle").click();
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "Stop Control",
  );
  await expectGlobalModeToggleLabel(desktopPage, "Control Here");
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([desktopSizedTerminal]);

  await mobilePage.getByTestId("terminal-fit-button").click();

  let mobileSizedTerminal = desktopSizedTerminal;
  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(mobilePage);
      mobileSizedTerminal = terminal;
      return terminal;
    })
    .not.toEqual(desktopSizedTerminal);
  await expect
    .poll(async () => getTerminalViewJustify(desktopPage))
    .toBe("center");
  await expect
    .poll(async () => getTerminalViewScale(desktopPage))
    .toBe(1);

  // Switch desktop back to "All" grid view, then take control
  await desktopPage.getByTestId("tab-all").click();
  await expectGlobalModeToggleLabel(desktopPage, "Control Here");
  await desktopPage.getByTestId("canvas-mode-toggle").click();
  await expectGlobalModeToggleLabel(desktopPage, "Stop Control");
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "Control Here",
  );
  // Click the terminal card in grid to open tab view
  await getTerminalCards(desktopPage).first().click();
  await expect(getImmersiveTerminal(desktopPage)).toBeVisible();
  await expect
    .poll(async () => listTerminals(desktopPage))
    .toEqual([mobileSizedTerminal]);

  await desktopPage.getByTestId("terminal-fit-button").click();

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
  await expandMachineSection(desktopPage);
  await desktopPage.getByTestId("machine-request-control-e2e-node").click();
  await openRootBookmark(desktopPage);
  await openRootBookmark(desktopPage);
  await expect
    .poll(async () => (await listTerminals(desktopPage)).length)
    .toBe(2);

  const initialTerminalIds = (await listTerminals(desktopPage))
    .map((terminal) => terminal.id)
    .sort();

  // Switch to grid view to see all terminals
  await desktopPage.getByTestId("tab-all").click();
  await expectTerminalCount(desktopPage, 2);
  await openApp(mobilePage);
  // Wait for terminals to sync
  await expect.poll(async () => (await listTerminals(mobilePage)).length).toBe(2);
  // Take control via API to avoid mobile UI overlap issues
  const mobileHeaders = await getAuthHeaders(mobilePage);
  const mobileDeviceId = await getDeviceId(mobilePage);
  await mobilePage.request.post("/api/mode/control", {
    headers: mobileHeaders,
    data: { machine_id: "e2e-node", device_id: mobileDeviceId },
  });
  await expectGlobalModeToggleLabel(mobilePage, "Stop Control");
  await expectGlobalModeToggleLabel(desktopPage, "Control Here");

  // Close a terminal via API instead of fighting mobile UI overlaps
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

import { expect, test, devices } from "@playwright/test";

import {
  expectGlobalModeToggleLabel,
  expectTerminalCount,
  expandMachineSection,
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
  await maximizeOnlyTerminal(desktopPage);
  await desktopPage.getByTestId("terminal-fit-button").click();

  const [desktopSizedTerminal] = await listTerminals(desktopPage);
  expect(desktopSizedTerminal).toBeDefined();

  await openApp(mobilePage);
  await expectTerminalCount(mobilePage, 1);
  const mobileCard = getTerminalCards(mobilePage).first();
  await expect(mobileCard.getByLabel("View only - cannot close")).toBeVisible();
  await mobileCard.getByLabel("Maximize").click();
  await expect(mobilePage.getByLabel("Minimize")).toBeVisible();

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
  await maximizeOnlyTerminal(desktopPage);
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

  await desktopPage.getByLabel("Minimize").click();
  await expectGlobalModeToggleLabel(desktopPage, "Control Here");
  await desktopPage.getByTestId("canvas-mode-toggle").click();
  await expectGlobalModeToggleLabel(desktopPage, "Stop Control");
  await expect(mobilePage.getByTestId("terminal-mode-toggle")).toHaveText(
    "Control Here",
  );
  await getTerminalCards(desktopPage).first().getByLabel("Maximize").click();
  await expect(desktopPage.getByLabel("Minimize")).toBeVisible();
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

  await expectTerminalCount(desktopPage, 2);
  await openApp(mobilePage);
  await expectTerminalCount(mobilePage, 2);
  await expectGlobalModeToggleLabel(mobilePage, "Control Here");
  await mobilePage.getByTestId("statusbar-mode-toggle").click();
  await expectGlobalModeToggleLabel(mobilePage, "Stop Control");
  await expectGlobalModeToggleLabel(desktopPage, "Control Here");

  await getTerminalCards(mobilePage).first().getByLabel("Close terminal").click();
  await expectTerminalCount(mobilePage, 1);
  await expectTerminalCount(desktopPage, 1);

  const remainingDesktopTerminals = await listTerminals(desktopPage);
  const remainingMobileTerminals = await listTerminals(mobilePage);
  expect(remainingDesktopTerminals).toEqual(remainingMobileTerminals);
  expect(remainingDesktopTerminals).toHaveLength(1);
  expect(initialTerminalIds).toContain(remainingDesktopTerminals[0]?.id);

  await desktop.close();
  await mobile.close();
});

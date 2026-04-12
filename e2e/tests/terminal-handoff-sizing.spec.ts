import { expect, test, devices } from "@playwright/test";

import {
  expectSingleTerminalCard,
  expandMachineSection,
  listTerminals,
  openApp,
} from "./helpers";

test("terminal size stays stable across maximize and cross-device handoff until fit is requested", async ({
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
  await expandMachineSection(desktopPage);
  await desktopPage.getByTestId("machine-request-control-e2e-node").click();
  await desktopPage.getByTestId("machine-bookmark-local-home").click();

  const desktopCard = await expectSingleTerminalCard(desktopPage);
  let initialTerminal: Awaited<ReturnType<typeof listTerminals>>[number] | null = null;
  await expect.poll(async () => {
    const terminals = await listTerminals(desktopPage);
    initialTerminal = terminals.length === 1 ? terminals[0] : null;
    return terminals.length;
  }).toBe(1);
  expect(initialTerminal).not.toBeNull();

  await desktopCard.getByLabel("Maximize").click();
  await expect(desktopPage.getByLabel("Minimize")).toBeVisible();

  await expect
    .poll(async () => listTerminals(desktopPage))
    .toEqual([initialTerminal]);

  await openApp(mobilePage);
  const mobileCard = await expectSingleTerminalCard(mobilePage);
  await mobilePage.getByTestId("statusbar-mode-toggle").click();
  await mobileCard.getByLabel("Maximize").click();
  await expect(mobilePage.getByLabel("Minimize")).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await mobilePage
          .locator("[data-terminal-display-mode='immersive']")
          .getAttribute("data-terminal-view-scale"),
      ),
    )
    .toBeLessThan(1);

  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([initialTerminal]);

  await mobilePage.getByTestId("terminal-fit-button").click();

  await expect
    .poll(async () => {
      const [terminal] = await listTerminals(mobilePage);
      return terminal;
    })
    .not.toEqual(initialTerminal);
  await expect
    .poll(async () =>
      await desktopPage
        .locator("[data-terminal-display-mode='immersive']")
        .getAttribute("data-terminal-view-justify"),
    )
    .toBe("center");
  await expect
    .poll(async () =>
      Number(
        await desktopPage
          .locator("[data-terminal-display-mode='immersive']")
          .getAttribute("data-terminal-view-scale"),
      ),
    )
    .toBe(1);

  await mobilePage.getByLabel("Close terminal").click();
  await expect
    .poll(async () => listTerminals(mobilePage))
    .toEqual([]);

  await desktop.close();
  await mobile.close();
});

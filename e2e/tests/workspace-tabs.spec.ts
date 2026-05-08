import { expect, test } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  listTerminals,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("workspace tabs persist user grouping while workpaths only choose launch cwd", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const homeTerminalId = await createTerminalViaApi(page, { cwd: "/root" });
  const tmpTerminalId = await createTerminalViaApi(page, { cwd: "/tmp" });

  await expect(page.getByTestId(`grid-card-${homeTerminalId}`)).toBeVisible();
  await expect(page.getByTestId(`grid-card-${tmpTerminalId}`)).toBeVisible();

  await expandTerminalById(page, homeTerminalId);
  await expect(workspaceGroup(page, "root")).toBeVisible();
  await expect(workspaceGroup(page, "tmp")).toBeVisible();

  const agentsLabel = `Agents-${Date.now()}`;
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("New tab name");
    await dialog.accept(agentsLabel);
  });
  await page.getByLabel("New tab").click();
  await expect(workspaceGroup(page, agentsLabel)).toBeVisible();

  await workspaceGroup(page, "tmp").click();
  await page.getByLabel("Move pane to tab").selectOption({ label: agentsLabel });

  await expect(workspaceGroup(page, "tmp")).toHaveCount(0);
  await expect(workspaceGroup(page, agentsLabel)).toBeVisible();
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(2);

  let terminals = await listTerminals(page);
  const assigned = terminals.filter((terminal) =>
    [homeTerminalId, tmpTerminalId].includes(terminal.id),
  );
  expect(new Set(assigned.map((terminal) => terminal.workspace_group_id)).size)
    .toBe(1);
  const workspaceGroupId = assigned[0].workspace_group_id;
  expect(workspaceGroupId).toBeTruthy();

  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(3);
  terminals = await listTerminals(page);
  const splitTerminal = terminals.find(
    (terminal) =>
      ![homeTerminalId, tmpTerminalId].includes(terminal.id),
  );
  expect(splitTerminal?.workspace_group_id).toBe(workspaceGroupId);
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(3);

  const scratchLabel = `Scratch-${Date.now()}`;
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("New tab name");
    await dialog.accept(scratchLabel);
  });
  await page.getByLabel("New tab").click();
  await expect(workspaceGroup(page, scratchLabel)).toBeVisible();

  terminals = await listTerminals(page);
  const scratchGroupId = terminals.find(
    (terminal) => terminal.id === splitTerminal?.id,
  )?.workspace_group_id;
  expect(scratchGroupId).toBeTruthy();

  await page.getByLabel("Move pane to tab").selectOption({ label: "cwd" });
  await workspaceGroup(page, scratchLabel).click();
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  await page.getByLabel("Split right").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(4);
  terminals = await listTerminals(page);
  const scratchTerminal = terminals.find(
    (terminal) =>
      ![homeTerminalId, tmpTerminalId, splitTerminal?.id].includes(terminal.id),
  );
  expect(scratchTerminal?.workspace_group_id).toBe(scratchGroupId);

  await context.close();
});

function workspaceGroup(page: import("@playwright/test").Page, label: string) {
  return page
    .locator("[data-testid^='workspace-group-']")
    .filter({ hasText: label });
}

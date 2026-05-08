import { expect, test } from "@playwright/test";

import {
  createWorkspaceGroupViaApi,
  createTerminalViaApi,
  expandTerminalById,
  listWorkspaceGroupsViaApi,
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
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  await workspaceGroup(page, "root").click();
  await page.getByLabel("Move pane to tab").selectOption({ label: agentsLabel });
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
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  const scratchGroupId = (await listWorkspaceGroupsViaApi(page)).find(
    (group) => group.name === scratchLabel,
  )?.id;
  expect(scratchGroupId).toBeTruthy();

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

test("creating a workspace tab opens an empty group without moving the active terminal", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const homeTerminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, homeTerminalId);

  const label = `Empty-${Date.now()}`;
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("New tab name");
    await dialog.accept(label);
  });
  await page.getByLabel("New tab").click();

  await expect(workspaceGroup(page, label)).toBeVisible();
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  const terminals = await listTerminals(page);
  expect(
    terminals.find((terminal) => terminal.id === homeTerminalId)
      ?.workspace_group_id,
  ).toBeFalsy();
});

test("workspace tabs can be reordered by dragging", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const first = await createWorkspaceGroupViaApi(
    page,
    `Drag A ${Date.now()}`,
  );
  const second = await createWorkspaceGroupViaApi(
    page,
    `Drag B ${Date.now()}`,
  );
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: first.id,
  });

  await expandTerminalById(page, terminalId);
  await expect(page.getByTestId(`workspace-group-${first.id}`)).toBeVisible();
  await expect(page.getByTestId(`workspace-group-${second.id}`)).toBeVisible();

  await page
    .getByTestId(`workspace-group-${second.id}`)
    .dragTo(page.getByTestId(`workspace-group-${first.id}`));

  await expect
    .poll(async () =>
      (await listWorkspaceGroupsViaApi(page))
        .map((group) => group.id)
        .filter((id) => id === first.id || id === second.id),
    )
    .toEqual([second.id, first.id]);
});

test("deleting a workspace tab keeps terminals open and clears their group", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const group = await createWorkspaceGroupViaApi(
    page,
    `Delete ${Date.now()}`,
  );
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: group.id,
  });

  await expandTerminalById(page, terminalId);
  await page.getByTestId(`workspace-group-delete-${group.id}`).click();
  await page.getByRole("button", { name: "Delete group", exact: true }).click();

  await expect(page.getByTestId(`workspace-group-${group.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`workspace-pane-${terminalId}`)).toBeVisible();

  const terminals = await listTerminals(page);
  expect(terminals.find((terminal) => terminal.id === terminalId))
    .toMatchObject({ workspace_group_id: null });
});

test("hovering a workspace group tab switches to that group", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const firstGroup = await createWorkspaceGroupViaApi(
    page,
    `Hover Group A ${Date.now()}`,
  );
  const secondGroup = await createWorkspaceGroupViaApi(
    page,
    `Hover Group B ${Date.now()}`,
  );
  const firstTerminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: firstGroup.id,
  });
  const secondTerminalId = await createTerminalViaApi(page, {
    cwd: "/tmp",
    workspaceGroupId: secondGroup.id,
  });

  await expandTerminalById(page, firstTerminalId);
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toBeVisible();
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toHaveCount(0);

  await page.getByTestId(`workspace-group-${secondGroup.id}`).hover();
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toBeVisible();
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toHaveCount(0);
});

test("hovering a workspace pane activates that terminal", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const group = await createWorkspaceGroupViaApi(
    page,
    `Hover ${Date.now()}`,
  );
  const firstTerminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: group.id,
  });
  const secondTerminalId = await createTerminalViaApi(page, {
    cwd: "/tmp",
    workspaceGroupId: group.id,
  });

  await expandTerminalById(page, secondTerminalId);
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toBeVisible();

  await page.getByTestId(`workspace-pane-${firstTerminalId}`).hover();
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toHaveCSS("box-shadow", /rgb/);
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toHaveCSS("box-shadow", "none");
});

function workspaceGroup(page: import("@playwright/test").Page, label: string) {
  return page
    .locator("[data-testid^='workspace-group-']")
    .filter({ hasText: label });
}

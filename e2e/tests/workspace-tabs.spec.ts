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

  await expect(workspaceGroup(page, "root")).toBeVisible();
  await expect(workspaceGroup(page, "tmp")).toBeVisible();

  await expandTerminalById(page, homeTerminalId);
  await expect(page.getByTestId(`workspace-pane-${homeTerminalId}`)).toBeVisible();

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
  await expect(page.getByTestId(`workspace-group-drag-${second.id}`))
    .toBeVisible();

  await dragWorkspaceGroupBefore(page, second.id, first.id);

  await expect
    .poll(async () =>
      (await listWorkspaceGroupsViaApi(page))
        .map((group) => group.id)
        .filter((id) => id === first.id || id === second.id),
    )
    .toEqual([second.id, first.id]);

  await expect
    .poll(async () =>
      (await visibleWorkspaceGroupIds(page)).filter(
        (id) => id === first.id || id === second.id,
      ),
    )
    .toEqual([second.id, first.id]);

  await dragWorkspaceGroupAfter(page, second.id, first.id);

  await expect
    .poll(async () =>
      (await listWorkspaceGroupsViaApi(page))
        .map((group) => group.id)
        .filter((id) => id === first.id || id === second.id),
    )
    .toEqual([first.id, second.id]);

  await expect
    .poll(async () =>
      (await visibleWorkspaceGroupIds(page)).filter(
        (id) => id === first.id || id === second.id,
      ),
    )
    .toEqual([first.id, second.id]);

  await page.reload();
  await page.getByTestId("workbench-header").waitFor({ state: "visible" });
  if (!(await page.getByTestId("expanded-terminal").isVisible())) {
    await expandTerminalById(page, terminalId);
  }
  await expect
    .poll(async () =>
      (await visibleWorkspaceGroupIds(page)).filter(
        (id) => id === first.id || id === second.id,
      ),
    )
    .toEqual([first.id, second.id]);
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

test("closing the last pane returns to the empty workbench state", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const group = await createWorkspaceGroupViaApi(
    page,
    `Close Pane ${Date.now()}`,
  );
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: group.id,
  });

  await expandTerminalById(page, terminalId);
  await page.getByTestId(`expanded-thumb-close-${terminalId}`).click();

  await expect(page.getByText(/No terminals/)).toBeVisible();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(0);
});

test("workspace close shortcut returns to the empty workbench state", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });

  await expandTerminalById(page, terminalId);
  await expect(page.getByTestId(`workspace-pane-${terminalId}`)).toBeVisible();
  await page.keyboard.press("Control+W");

  await expect(page.getByText(/No terminals/)).toBeVisible();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(0);
});

test("canceling close for a busy workspace pane keeps the pane visible", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const group = await createWorkspaceGroupViaApi(
    page,
    `Busy Pane ${Date.now()}`,
  );
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: group.id,
  });
  await page.route(
    `**/api/machines/e2e-node/terminals/${terminalId}/foreground-process`,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          has_foreground_process: true,
          process_name: "sleep",
        }),
      });
    },
  );

  await expandTerminalById(page, terminalId);
  await page.getByTestId(`expanded-thumb-close-${terminalId}`).click();
  await expect(
    page.getByRole("dialog", { name: "Close terminal?" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(
    page.getByRole("dialog", { name: "Close terminal?" }),
  ).toHaveCount(0);
  await expect(page.getByTestId(`workspace-pane-${terminalId}`)).toBeVisible();
  await expect(page.getByTestId("workspace-empty-group")).toHaveCount(0);
  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);
});

test("confirming close for a busy cwd pane keeps an empty cwd group open", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await page.route(
    `**/api/machines/e2e-node/terminals/${terminalId}/foreground-process`,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          has_foreground_process: true,
          process_name: "sleep",
        }),
      });
    },
  );

  await expandTerminalById(page, terminalId);
  await page.getByTestId(`expanded-thumb-close-${terminalId}`).click();
  await page
    .getByRole("dialog", { name: "Close terminal?" })
    .getByRole("button", { name: "Close terminal" })
    .click();

  await expect.poll(async () => (await listTerminals(page)).length).toBe(0);
  await expect(page.getByText(/No terminals/)).toBeVisible();
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

test("workspace shortcuts switch groups with a custom binding", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      "webmux:workspace-shortcuts",
      JSON.stringify({
        groupNext: "Mod+Alt+KeyG",
        groupPrevious: "Mod+Alt+KeyF",
      }),
    );
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const firstGroup = await createWorkspaceGroupViaApi(
    page,
    `Key Group A ${Date.now()}`,
  );
  const secondGroup = await createWorkspaceGroupViaApi(
    page,
    `Key Group B ${Date.now()}`,
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
  await page.keyboard.press("Control+Alt+KeyG");
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toBeVisible();
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toHaveCount(0);

  await page.keyboard.press("Control+Alt+KeyF");
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toBeVisible();

  await context.close();
});

test("settings can record workspace shortcut bindings", async ({ page }) => {
  await openApp(page);

  await page.getByTestId("workbench-open-settings").click();
  const recorder = page.getByTestId("workspace-shortcut-recorder-groupNext");
  await recorder.click();
  await page.keyboard.press("Control+Alt+KeyG");

  await expect(recorder).toHaveText("Ctrl/Cmd + Alt + G");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("webmux:workspace-shortcuts") ?? "{}"),
  );
  expect(stored.groupNext).toBe("Mod+Alt+KeyG");
});

test("settings reject duplicate workspace shortcut bindings", async ({ page }) => {
  await openApp(page);

  await page.getByTestId("workbench-open-settings").click();
  const recorder = page.getByTestId("workspace-shortcut-recorder-groupNext");
  await recorder.click();
  await page.keyboard.press("Control+ArrowLeft");

  await expect(page.getByTestId("workspace-shortcut-conflict"))
    .toContainText("Focus pane left");
  await expect(recorder).toHaveText("Press keys...");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("webmux:workspace-shortcuts") ?? "{}"),
  );
  expect(stored.groupNext).toBeUndefined();
});

function workspaceGroup(page: import("@playwright/test").Page, label: string) {
  return page
    .locator("[data-testid^='workspace-group-']")
    .filter({ hasText: label });
}

async function visibleWorkspaceGroupIds(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page
    .locator(
      "button[data-testid^='workspace-group-']:not([data-testid^='workspace-group-delete-'])",
    )
    .evaluateAll((buttons) =>
      buttons
        .map((button) => button.getAttribute("data-testid") ?? "")
        .map((testId) => testId.replace(/^workspace-group-/, ""))
        .filter(Boolean),
    );
}

async function dragWorkspaceGroupBefore(
  page: import("@playwright/test").Page,
  sourceGroupId: string,
  targetGroupId: string,
): Promise<void> {
  await dragWorkspaceGroupTo(page, sourceGroupId, targetGroupId, "before");
}

async function dragWorkspaceGroupAfter(
  page: import("@playwright/test").Page,
  sourceGroupId: string,
  targetGroupId: string,
): Promise<void> {
  await dragWorkspaceGroupTo(page, sourceGroupId, targetGroupId, "after");
}

async function dragWorkspaceGroupTo(
  page: import("@playwright/test").Page,
  sourceGroupId: string,
  targetGroupId: string,
  placement: "before" | "after",
): Promise<void> {
  const source = page.getByTestId(`workspace-group-drag-${sourceGroupId}`);
  const target = page.getByTestId(`workspace-group-${targetGroupId}`);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  const targetX =
    placement === "before"
      ? targetBox!.x + Math.min(8, targetBox!.width / 4)
      : targetBox!.x + targetBox!.width - Math.min(8, targetBox!.width / 4);
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetX,
    targetBox!.y + targetBox!.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
}

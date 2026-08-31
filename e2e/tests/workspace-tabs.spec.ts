import { expect, test } from "@playwright/test";

import {
  createWorkspaceGroupViaApi,
  createTerminalViaApi,
  deleteWorkspaceGroupViaApi,
  expandTerminalById,
  listWorkspaceGroupsViaApi,
  listTerminals,
  openApp,
  openPaneContextMenu,
  pressPrefixKey,
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
  await createWorkspaceGroupViaApi(page, agentsLabel);
  await expect(workspaceGroup(page, agentsLabel)).toBeVisible();
  await workspaceGroup(page, agentsLabel).click();
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  await workspaceGroup(page, "root").click();
  await movePaneToTab(page, homeTerminalId, agentsLabel);
  await workspaceGroup(page, "tmp").click();
  await movePaneToTab(page, tmpTerminalId, agentsLabel);

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

  // ⌃B % splits the active pane into the same tab.
  await pressPrefixKey(page, "Shift+Digit5");
  await expect.poll(async () => (await listTerminals(page)).length).toBe(3);
  terminals = await listTerminals(page);
  const splitTerminal = terminals.find(
    (terminal) =>
      ![homeTerminalId, tmpTerminalId].includes(terminal.id),
  );
  expect(splitTerminal?.workspace_group_id).toBe(workspaceGroupId);
  await expect(page.locator("[data-testid^='workspace-pane-']")).toHaveCount(3);

  const scratchLabel = `Scratch-${Date.now()}`;
  const scratchGroup = await createWorkspaceGroupViaApi(page, scratchLabel);
  await expect(workspaceGroup(page, scratchLabel)).toBeVisible();
  await workspaceGroup(page, scratchLabel).click();
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  await pressPrefixKey(page, "Shift+Digit5");
  await expect.poll(async () => (await listTerminals(page)).length).toBe(4);
  terminals = await listTerminals(page);
  const scratchTerminal = terminals.find(
    (terminal) =>
      ![homeTerminalId, tmpTerminalId, splitTerminal?.id].includes(terminal.id),
  );
  expect(scratchTerminal?.workspace_group_id).toBe(scratchGroup.id);

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
  await createWorkspaceGroupViaApi(page, label);
  await expect(workspaceGroup(page, label)).toBeVisible();
  await workspaceGroup(page, label).click();

  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  // The terminal stays in the tab the hub opened for it — the new tab is empty.
  const terminals = await listTerminals(page);
  const homeGroupId = terminals.find(
    (terminal) => terminal.id === homeTerminalId,
  )?.workspace_group_id;
  expect(homeGroupId).toBeTruthy();
  const created = (await listWorkspaceGroupsViaApi(page)).find(
    (group) => group.name === label,
  );
  expect(created?.id).not.toBe(homeGroupId);
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
  await expect(page.getByTestId(`sidebar-section-${first.id}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-section-${second.id}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-section-drag-${second.id}`))
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
  await page.getByTestId("sidebar").waitFor({ state: "visible" });
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

test("sidebar host meters report host cpu, memory, and disk", async ({ page }) => {
  await openApp(page);

  // The hosts rail shows one meters row per machine; e2e has a single node.
  await expect(page.getByTestId("sidebar-host-e2e-node-meters")).toBeVisible();
  // Label and value sit in sibling spans with no separator, so "cpu12%".
  // Wait for a real reading rather than the "—" placeholder, so the assertion
  // fails if stats stop reaching the meters.
  for (const label of ["cpu", "mem", "disk"]) {
    await expect(
      page.getByTestId(`sidebar-host-e2e-node-meter-${label}`),
    ).toHaveText(
      new RegExp(`^${label}\\s*\\d+%$`),
      { timeout: 15_000 },
    );
  }
});

test("workspace tabs can be reordered by dragging the tab body", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const first = await createWorkspaceGroupViaApi(
    page,
    `Tab Drag A ${Date.now()}`,
  );
  const second = await createWorkspaceGroupViaApi(
    page,
    `Tab Drag B ${Date.now()}`,
  );
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: first.id,
  });

  await expandTerminalById(page, terminalId);
  await expect(page.getByTestId(`sidebar-section-${first.id}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-section-${second.id}`)).toBeVisible();

  // Drag starting on the tab label button (not the grip handle), past the
  // threshold, releasing over the other tab.
  await dragWorkspaceGroupTo(
    page,
    second.id,
    first.id,
    "before",
    page.getByTestId(`sidebar-section-${second.id}`),
  );

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

  // A plain press-and-release on a tab label (no movement) still selects it.
  const secondTab = page.getByTestId(`sidebar-section-${second.id}`);
  const secondBox = await secondTab.boundingBox();
  expect(secondBox).toBeTruthy();
  await page.mouse.move(
    secondBox!.x + secondBox!.width / 2,
    secondBox!.y + secondBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.up();
  // The second group is empty, so selecting it shows the empty-group state.
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();

  // The click was a selection, not a drag — order is unchanged.
  await expect
    .poll(async () =>
      (await listWorkspaceGroupsViaApi(page))
        .map((group) => group.id)
        .filter((id) => id === first.id || id === second.id),
    )
    .toEqual([second.id, first.id]);
});

test("a new tab lands at the end of the strip, after the hub-created ones", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  // Terminals created without a tab get one each, named after their cwd.
  const rootTerminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await createTerminalViaApi(page, { cwd: "/tmp" });
  await expandTerminalById(page, rootTerminalId);
  await expect(workspaceGroup(page, "root")).toBeVisible();
  await expect(workspaceGroup(page, "tmp")).toBeVisible();

  // The brand-row ＋ now opens the new-session dialog; a bare new tab comes
  // from the command palette's "New tab" action.
  await pressPrefixKey(page, "k");
  await page.getByTestId("command-palette-row-new-tab").click();

  await expect.poll(async () => (await listWorkspaceGroupsViaApi(page)).length)
    .toBe(3);
  const created = (await listWorkspaceGroupsViaApi(page)).find((group) =>
    !["root", "tmp"].includes(group.name),
  )!;
  await expect
    .poll(async () => (await visibleWorkspaceGroupIds(page)).at(-1))
    .toBe(created.id);
});

test("hub-created tabs can be reordered by dragging", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const rootTerminalId = await createTerminalViaApi(page, { cwd: "/root" });
  const tmpTerminalId = await createTerminalViaApi(page, { cwd: "/tmp" });

  await expandTerminalById(page, rootTerminalId);
  const tabs = await listWorkspaceGroupsViaApi(page);
  const rootTab = tabs.find((group) => group.name === "root")!;
  const tmpTab = tabs.find((group) => group.name === "tmp")!;
  await expect(page.getByTestId(`sidebar-section-${rootTab.id}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar-section-${tmpTab.id}`)).toBeVisible();

  await dragWorkspaceGroupBefore(page, tmpTab.id, rootTab.id);

  await expect
    .poll(async () =>
      (await listWorkspaceGroupsViaApi(page)).map((group) => group.name),
    )
    .toEqual(["tmp", "root"]);
  await expect
    .poll(async () => await visibleWorkspaceGroupIds(page))
    .toEqual([tmpTab.id, rootTab.id]);

  // Each tab still shows its own pane.
  await page.getByTestId(`sidebar-section-${tmpTab.id}`).click();
  await expect(page.getByTestId(`workspace-pane-${tmpTerminalId}`))
    .toBeVisible();
  await page.getByTestId(`sidebar-section-${rootTab.id}`).click();
  await expect(page.getByTestId(`workspace-pane-${rootTerminalId}`))
    .toBeVisible();
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
  await deleteWorkspaceGroupViaApi(page, group.id);

  await expect(page.getByTestId(`sidebar-section-${group.id}`)).toHaveCount(0);
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
  await pressPrefixKey(page, "x");

  await expect(page.getByText(/No terminals/)).toBeVisible();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(0);
});

test("workspace close prefix returns to the empty workbench state", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });

  await expandTerminalById(page, terminalId);
  await expect(page.getByTestId(`workspace-pane-${terminalId}`)).toBeVisible();
  await pressPrefixKey(page, "x");

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
  await pressPrefixKey(page, "x");
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
  await pressPrefixKey(page, "x");
  await page
    .getByRole("dialog", { name: "Close terminal?" })
    .getByRole("button", { name: "Close terminal" })
    .click();

  await expect.poll(async () => (await listTerminals(page)).length).toBe(0);
  await expect(page.getByText(/No terminals/)).toBeVisible();
});

test("clicking a sidebar section switches to that group", async ({ page }) => {
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

  await page.getByTestId(`sidebar-section-${secondGroup.id}`).click();
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toBeVisible();
  // Keep-alive: the switched-away group stays mounted but hidden.
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toBeHidden();
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

test("prefix bindings switch groups with a custom second key", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      "offdesk:prefix-bindings",
      JSON.stringify({
        nextTab: "g",
        prevTab: "f",
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
  await pressPrefixKey(page, "g");
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toBeVisible();
  // Keep-alive: the switched-away group stays mounted but hidden.
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toBeHidden();

  await pressPrefixKey(page, "f");
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toBeVisible();

  await context.close();
});

test("settings can record prefix bindings", async ({ page }) => {
  await openApp(page);

  await openSettingsViaPalette(page);
  const recorder = page.getByTestId("prefix-binding-recorder-nextTab");
  await recorder.click();
  await page.keyboard.press("g");

  await expect(recorder).toHaveText("⌃B g");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("offdesk:prefix-bindings") ?? "{}"),
  );
  expect(stored.nextTab).toBe("g");
});

test("settings reject duplicate prefix bindings", async ({ page }) => {
  await openApp(page);

  await openSettingsViaPalette(page);
  const recorder = page.getByTestId("prefix-binding-recorder-nextTab");
  await recorder.click();
  await page.keyboard.press("ArrowLeft");

  await expect(page.getByTestId("prefix-binding-conflict"))
    .toContainText("Focus pane left");
  await expect(recorder).toHaveText("⌃B + key...");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("offdesk:prefix-bindings") ?? "{}"),
  );
  expect(stored.nextTab).toBeUndefined();
});

function workspaceGroup(page: import("@playwright/test").Page, label: string) {
  return page
    .locator("div[data-testid^='sidebar-section-']")
    .filter({ hasText: label });
}

// Move a pane to a persistent tab via the pane's right-click context menu
// ("Move pane to tab ▸" submenu — the replacement for the old <select>).
async function movePaneToTab(
  page: import("@playwright/test").Page,
  terminalId: string,
  tabLabel: string,
): Promise<void> {
  await openPaneContextMenu(page, terminalId);
  await page.getByRole("button", { name: "Move pane to tab" }).hover();
  await page
    .getByTestId("context-menu")
    .getByRole("button", { name: tabLabel, exact: true })
    .click();
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
}

// Open the desktop Settings overlay through the command palette (⌃B k).
async function openSettingsViaPalette(
  page: import("@playwright/test").Page,
): Promise<void> {
  await pressPrefixKey(page, "k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-palette-row-settings").click();
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await expect(page.getByTestId("prefix-binding-recorder-nextTab"))
    .toBeVisible();
}

async function visibleWorkspaceGroupIds(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page
    .locator("div[data-testid^='sidebar-section-']")
    .evaluateAll((sections) =>
      sections
        .map((section) => section.getAttribute("data-testid") ?? "")
        .map((testId) => testId.replace(/^sidebar-section-/, ""))
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

// Sidebar sections stack vertically: the drop placement comes from the
// pointer's Y against the target section's midpoint (before = upper half).
async function dragWorkspaceGroupTo(
  page: import("@playwright/test").Page,
  sourceGroupId: string,
  targetGroupId: string,
  placement: "before" | "after",
  source?: import("@playwright/test").Locator,
): Promise<void> {
  const sourceLocator =
    source ?? page.getByTestId(`sidebar-section-drag-${sourceGroupId}`);
  const target = page.getByTestId(`sidebar-section-${targetGroupId}`);
  await sourceLocator.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await sourceLocator.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();
  const targetY =
    placement === "before"
      ? targetBox!.y + Math.min(6, targetBox!.height / 4)
      : targetBox!.y + targetBox!.height - Math.min(6, targetBox!.height / 4);
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2,
    sourceBox!.y + sourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetY,
    { steps: 10 },
  );
  await page.mouse.up();
}

test("sidebar creates tabs via the palette and deletes them via the section context menu", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, terminalId);

  // The terminal already sits in the tab the hub opened for it.
  const cwdTab = (await listWorkspaceGroupsViaApi(page))[0];

  // The brand-row ＋ now opens the new-session dialog; a bare second tab
  // comes from the command palette's "New tab" action.
  await pressPrefixKey(page, "k");
  await page.getByTestId("command-palette-row-new-tab").click();
  await expect
    .poll(async () => (await listWorkspaceGroupsViaApi(page)).length)
    .toBe(2);
  const created = (await listWorkspaceGroupsViaApi(page)).find(
    (group) => group.id !== cwdTab.id,
  )!;

  // New tab deterministically becomes the active (empty) group; switch back
  // to the terminal's tab so the pane is mounted again before opening its menu.
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();
  await page.getByTestId(`sidebar-section-${cwdTab.id}`).click();

  // Move the pane into the new tab, then delete the tab from its context
  // menu — the confirm dialog appears because it holds a pane.
  await openPaneContextMenu(page, terminalId);
  await page.getByRole("button", { name: "Move pane to tab" }).hover();
  await page
    .getByTestId("context-menu")
    .getByRole("button", { name: created.name })
    .click();
  // Emptied, the hub-created tab goes with its last pane.
  await expect
    .poll(async () => (await listWorkspaceGroupsViaApi(page)).length)
    .toBe(1);
  await page
    .getByTestId(`sidebar-section-${created.id}`)
    .click({ button: "right" });
  await page.getByRole("button", { name: `Delete tab "${created.name}"` }).click();
  await page
    .getByRole("dialog", { name: "Delete tab?" })
    .getByRole("button", { name: "Delete tab" })
    .click();

  // Group row is gone server-side; the terminal survives in its cwd tab.
  await expect
    .poll(async () => (await listWorkspaceGroupsViaApi(page)).length)
    .toBe(0);
  const terminals = await listTerminals(page);
  expect(terminals.map((t: { id: string }) => t.id)).toContain(terminalId);
  await expect(
    page.locator("div[data-testid^='sidebar-section-']"),
  ).toHaveCount(1);
});

test("tab context menu renames a workspace tab", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const group = await createWorkspaceGroupViaApi(page, `Rename ${Date.now()}`);
  await expect(workspaceGroup(page, group.name)).toBeVisible();

  // Right-click the tab → Rename tab opens the rename dialog.
  await page
    .locator(`[data-testid='sidebar-section-${group.id}']`)
    .click({ button: "right" });
  await page
    .getByTestId("context-menu")
    .getByRole("button", { name: "Rename tab" })
    .click();

  const renamed = `Renamed ${Date.now()}`;
  const dialog = page.getByRole("dialog", { name: "Rename tab" });
  await dialog.getByRole("textbox", { name: "Tab name" }).fill(renamed);
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();

  // Tab label updates and the new name is persisted server-side.
  await expect(workspaceGroup(page, renamed)).toBeVisible();
  await expect
    .poll(
      async () =>
        (await listWorkspaceGroupsViaApi(page)).find(
          (g: { id: string }) => g.id === group.id,
        )?.name,
    )
    .toBe(renamed);
});

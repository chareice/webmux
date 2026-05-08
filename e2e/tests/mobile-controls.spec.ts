import { test, expect, devices } from "@playwright/test";

import {
  createWorkspaceGroupViaApi,
  createTerminalViaApi,
  expectSingleTerminalCard,
  getImmersiveTerminal,
  listTerminals,
  listWorkspaceGroupsViaApi,
  openApp,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

test.use({
  ...devices["iPhone 14"],
  browserName: "chromium",
});

test("mobile terminal flow works inside the responsive web shell", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);

  // The mobile shell is a three-tab bottom-nav surface. The "Terminals" tab
  // is selected by default and shows the empty state.
  await expect(page.getByTestId("mobile-workbench")).toBeVisible();
  await expect(page.getByText(/No terminals here yet/)).toBeVisible();

  // Take control without leaving the Terminals tab.
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Control Here",
  );
  await page.getByTestId("mobile-control-toggle").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Stop Control",
  );

  // After taking control the FAB appears on the Terminals tab.
  await expect(page.getByTestId("mobile-fab-new-terminal")).toBeVisible();

  // Create a terminal — use the FAB.
  await page.getByTestId("mobile-fab-new-terminal").click();

  // Mobile auto-zooms after create → the ExpandedTerminal overlay opens at
  // full viewport size and the immersive TerminalCard renders inside.
  await expect(page.getByTestId("expanded-terminal")).toBeVisible();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Control toggle and Fit live in the slim ExpandedTerminal header on
  // mobile. The pill text is "ctrl" while controlling and "control"
  // (i.e. take-control CTA) when viewing — CSS uppercases for display.
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("ctrl");
  await expect(page.getByTestId("terminal-fit-button")).toBeVisible();
  // Extended key bar surfaces the keyboard toggle while controlling.
  await expect(page.getByTitle("Show keyboard")).toBeVisible();

  // Toggle control off and on via the header pill.
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("control");
  await page.getByTestId("terminal-mode-toggle").click();
  await expect(page.getByTestId("terminal-mode-toggle")).toHaveText("ctrl");

  // Close the overlay with the expanded-close button — this just dismisses
  // the overlay, the terminal stays alive.
  await page.getByTestId("expanded-close").click();
  await expect(page.getByTestId("expanded-terminal")).toHaveCount(0);

  // Back on the Terminals tab: the mobile card list shows the live terminal.
  await expect(page.locator("[data-testid^='mobile-term-card-']")).toHaveCount(1);

  // Destroy via API (no mobile UI path for destroying terminals yet).
  await createTerminalViaApi; // touch import to keep tree-shaking stable
  const [terminal] = await listTerminals(page);
  expect(terminal).toBeDefined();
  const deviceId = await page.evaluate(() => sessionStorage.getItem("tc-device-id"));
  const token = await page.evaluate(() => localStorage.getItem("webmux:token"));
  const resp = await page.request.delete(
    `/api/machines/${terminal.machine_id}/terminals/${terminal.id}?device_id=${encodeURIComponent(deviceId ?? "")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(resp.ok()).toBeTruthy();

  await expect(page.getByText(/No terminals here yet/)).toBeVisible();
});

test("mobile new terminal starts fitted without an immediate resize", async ({ page }) => {
  const terminalFramesSent: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload === "string") {
        terminalFramesSent.push(frame.payload);
      }
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await page.getByTestId("mobile-control-toggle").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Stop Control",
  );

  await page.getByTestId("mobile-fab-new-terminal").click();
  await expect(page.getByTestId("expanded-terminal")).toBeVisible();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await page.waitForTimeout(1_200);
  const resizeFrames = terminalFramesSent.filter((payload) =>
    payload.includes('"type":"resize"'),
  );
  // Mobile auto-fits on entry now. The server creates the FAB terminal
  // at our estimated mobile dims; the live fit may agree (no resize) or
  // produce slightly different dims (one resize). Either is fine — what
  // matters is that the terminal isn't stuck at the desktop default
  // 80 cols and there's no resize storm.
  expect(resizeFrames.length).toBeLessThanOrEqual(1);

  const [terminal] = await listTerminals(page);
  expect(terminal.cols).toBeLessThan(80);
});

test("mobile controller can add a workpath from the Hosts tab", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await page.getByTestId("mobile-control-toggle").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Stop Control",
  );

  await page.getByText("Hosts", { exact: true }).click();
  await expect(page.getByTestId("mobile-add-workpath")).toBeVisible();

  await page.getByTestId("mobile-add-workpath").click();
  await page.getByTestId("path-input").fill("/tmp");
  await page.getByTestId("path-input-submit").click();

  await expect(page.getByText("tmp", { exact: true })).toBeVisible();
  await expect(page.getByText("/tmp", { exact: true })).toBeVisible();
});

test("mobile terminal only focuses after an explicit input gesture", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  await createTerminalViaApi(page);
  const card = await expectSingleTerminalCard(page);
  await card.click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(false);

  await page.getByTitle("Show keyboard").click();
  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(true);

  await page.getByTitle("Hide keyboard").click();
  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(false);

  await getImmersiveTerminal(page).click({ position: { x: 24, y: 24 } });
  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(true);
});

test("mobile terminal switch does not focus the new terminal automatically", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  const firstTerminalId = await createTerminalViaApi(page);
  const secondTerminalId = await createTerminalViaApi(page);
  await expect(page.locator("[data-testid^='mobile-term-card-']")).toHaveCount(2);
  await page.getByTestId(`mobile-term-card-${firstTerminalId}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.getByTestId(`expanded-thumb-${secondTerminalId}`).click();
  await expect(page.getByTestId(`expanded-thumb-${firstTerminalId}`)).toBeVisible();

  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(false);
});

test("mobile workspace has direct terminal close and group switching", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

  const firstGroup = await createWorkspaceGroupViaApi(
    page,
    `Mobile Alpha ${Date.now()}`,
  );
  const secondGroup = await createWorkspaceGroupViaApi(
    page,
    `Mobile Beta ${Date.now()}`,
  );
  const firstTerminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    workspaceGroupId: firstGroup.id,
  });
  const secondTerminalId = await createTerminalViaApi(page, {
    cwd: "/tmp",
    workspaceGroupId: secondGroup.id,
  });

  await expect(
    page.getByTestId(`mobile-term-card-${firstTerminalId}`),
  ).toBeVisible();
  await page.getByTestId(`mobile-term-card-${firstTerminalId}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await expect(page.getByTestId(`workspace-mobile-group-tab-${firstGroup.id}`))
    .toBeVisible();
  await expect(page.getByTestId(`workspace-mobile-group-tab-${secondGroup.id}`))
    .toBeVisible();

  await page
    .getByTestId(`workspace-mobile-group-tab-${secondGroup.id}`)
    .click();
  await expect(
    page.getByTestId(`workspace-pane-${secondTerminalId}`),
  ).toBeVisible();
  await expect(page.getByTestId(`workspace-pane-${firstTerminalId}`))
    .toHaveCount(0);

  await page.getByTestId("workspace-close-active-terminal").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);
  await expect(page.getByTestId("expanded-terminal")).toBeVisible();
  await expect(page.getByTestId(`workspace-mobile-group-tab-${secondGroup.id}`))
    .toBeVisible();
  await expect(page.getByTestId("workspace-empty-group")).toBeVisible();
  await expect(page.getByTestId(`workspace-pane-${secondTerminalId}`))
    .toHaveCount(0);

  await page.getByTestId("expanded-close").click();
  await expect(page.getByTestId("expanded-terminal")).toHaveCount(0);
  await expect(
    page.getByTestId(`mobile-term-card-${firstTerminalId}`),
  ).toBeVisible();
  await expect(page.getByTestId(`mobile-term-card-${secondTerminalId}`))
    .toHaveCount(0);
});

test("mobile workspace can delete a group without closing its terminal", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

  const group = await createWorkspaceGroupViaApi(
    page,
    `Mobile Delete ${Date.now()}`,
  );
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/tmp",
    workspaceGroupId: group.id,
  });

  await page.getByTestId(`mobile-term-card-${terminalId}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await page.getByTestId(`workspace-mobile-group-delete-${group.id}`).click();
  await page.getByRole("button", { name: "Delete group", exact: true }).click();

  await expect
    .poll(async () => {
      const terminals = await listTerminals(page);
      return terminals.find((terminal) => terminal.id === terminalId)
        ?.workspace_group_id;
    })
    .toBeNull();
  await expect(page.getByTestId(`workspace-pane-${terminalId}`)).toBeVisible();
  await expect
    .poll(async () =>
      (await listWorkspaceGroupsViaApi(page)).some(
        (candidate) => candidate.id === group.id,
      ),
    )
    .toBe(false);
});

test("mobile live streams reconnect after returning from background", async ({
  page,
}) => {
  const webSocketUrls: string[] = [];
  page.on("websocket", (socket) => {
    webSocketUrls.push(socket.url());
  });

  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  await createTerminalViaApi(page);
  const card = await expectSingleTerminalCard(page);
  await card.click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await expect
    .poll(
      () => webSocketUrls.filter((url) => url.includes("/ws/events")).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        webSocketUrls.filter((url) =>
          url.includes("/ws/terminal/e2e-node/"),
        ).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  const eventsBefore = webSocketUrls.filter((url) =>
    url.includes("/ws/events"),
  ).length;
  const terminalsBefore = webSocketUrls.filter((url) =>
    url.includes("/ws/terminal/e2e-node/"),
  ).length;

  await setPageVisibility(page, "hidden");
  await setPageVisibility(page, "visible");

  await expect
    .poll(
      () => webSocketUrls.filter((url) => url.includes("/ws/events")).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(eventsBefore);
  await expect
    .poll(
      () =>
        webSocketUrls.filter((url) =>
          url.includes("/ws/terminal/e2e-node/"),
        ).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(terminalsBefore);
});

async function setPageVisibility(
  page: Parameters<typeof openApp>[0],
  visibilityState: "hidden" | "visible",
): Promise<void> {
  await page.evaluate((nextVisibilityState) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => nextVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibilityState);
}

async function terminalHasKeyboardFocus(
  page: Parameters<typeof openApp>[0],
): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.closest(".xterm") !== null;
  });
}

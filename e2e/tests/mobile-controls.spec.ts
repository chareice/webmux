import { test, expect, devices } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  createWorkspaceGroupViaApi,
  createTerminalViaApi,
  getImmersiveTerminal,
  listTerminals,
  longPressStripChip,
  mobileTakeControl,
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

  // The mobile shell is session strip (top) + terminal (middle) + key bar
  // (bottom). With no terminals it shows the strip and a centered
  // "Start terminal" empty state; the start button needs control.
  await expect(page.getByTestId("mobile-workbench")).toBeVisible();
  await expect(page.getByTestId("mobile-session-strip")).toBeVisible();
  await expect(page.getByText(/No terminals yet/)).toBeVisible();
  await expect(page.getByTestId("empty-new-terminal")).toHaveCount(0);

  // Take control from the host sheet (strip right-end host button).
  await mobileTakeControl(page);
  await expect(page.getByTestId("empty-new-terminal")).toBeVisible();

  // Create a terminal — the shell opens straight into it.
  await page.getByTestId("empty-new-terminal").click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // The strip now carries one chip per terminal; the key bar surfaces the
  // keyboard toggle while controlling.
  const [terminal] = await listTerminals(page);
  expect(terminal).toBeDefined();
  await expect(
    page.getByTestId(`mobile-strip-chip-${terminal.id}`),
  ).toBeVisible();
  await expect(page.getByTitle("Show keyboard")).toBeVisible();

  // Engage view-only via the host sheet: this releases control, so the
  // keyboard toggle disappears and the new-terminal chip becomes disabled.
  await page.getByTestId("mobile-host-button").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "View only",
  );
  await page.getByTestId("mobile-control-toggle").click();
  await expect(page.getByTitle("Show keyboard")).toHaveCount(0);
  await expect(page.getByTestId("mobile-strip-new-terminal")).toBeDisabled();

  // Unlock without claiming; the existing Take control flow remains explicit.
  await page.getByTestId("mobile-host-button").click();
  await expect(page.getByTestId("mobile-control-toggle")).toHaveText(
    "Unlock view only",
  );
  await page.getByTestId("mobile-control-toggle").click();

  // Take control back.
  await mobileTakeControl(page);
  await expect(page.getByTestId("mobile-strip-new-terminal")).toBeEnabled();

  // Destroy via API → the shell returns to the empty state and the chip
  // disappears.
  const deviceId = await page.evaluate(() => sessionStorage.getItem("tc-device-id"));
  const token = await page.evaluate(() => localStorage.getItem("webmux:token"));
  const resp = await page.request.delete(
    `/api/machines/${terminal.machine_id}/terminals/${terminal.id}?device_id=${encodeURIComponent(deviceId ?? "")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(resp.ok()).toBeTruthy();
  await expect(page.getByText(/No terminals yet/)).toBeVisible();
  await expect(
    page.getByTestId(`mobile-strip-chip-${terminal.id}`),
  ).toHaveCount(0);
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
  await mobileTakeControl(page);

  await page.getByTestId("empty-new-terminal").click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await page.waitForTimeout(1_200);
  const resizeFrames = terminalFramesSent.filter((payload) =>
    payload.includes('"type":"resize"'),
  );
  // Mobile auto-fits on entry now. The server creates the terminal at our
  // estimated mobile dims; the live fit may agree (no resize) or produce
  // slightly different dims (one resize). Either is fine — what matters is
  // that the terminal isn't stuck at the desktop default 80 cols and
  // there's no resize storm.
  expect(resizeFrames.length).toBeLessThanOrEqual(1);

  const [terminal] = await listTerminals(page);
  expect(terminal.cols).toBeLessThan(80);
});

test("mobile terminal only focuses after an explicit input gesture", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  await createTerminalViaApi(page);

  // No card list anymore — the shell shows the terminal directly.
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

  await getImmersiveTerminal(page).click({ position: { x: 40, y: 40 } });
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
  await expect(
    page.getByTestId(`mobile-strip-chip-${firstTerminalId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`mobile-strip-chip-${secondTerminalId}`),
  ).toBeVisible();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.getByTestId(`mobile-strip-chip-${secondTerminalId}`).click();
  await expect(
    page.getByTestId(`workspace-pane-${secondTerminalId}`),
  ).toBeVisible();

  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(false);
});

test("mobile touch drag sends terminal scroll input", async ({ page }) => {
  const inputFrames: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const payload = JSON.parse(frame.payload) as
        | { type: "input"; data: string }
        | { type: string };
      if (payload.type === "input") {
        inputFrames.push(payload.data);
      }
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    startupCommand: "sleep 600",
  });

  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect.poll(() => hasXtermInstance(page, terminalId)).toBe(true);

  inputFrames.length = 0;
  await dispatchTerminalTouchDrag(page);
  const terminalSize = await getXtermSize(page, terminalId);
  const expectedCol = Math.round(terminalSize.cols / 2);
  const expectedRow = Math.round(terminalSize.rows / 2);

  await expect
    .poll(() => {
      const frame = inputFrames.map(parseWheelMouseFrame).find(Boolean);
      if (!frame) return false;
      return (
        Math.abs(frame.col - expectedCol) <= 2 &&
        Math.abs(frame.row - expectedRow) <= 2
      );
    })
    .toBe(true);
});

test("mobile session strip switches terminals and closes them via the chip sheet", async ({
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

  // One chip per terminal, ordered by group.
  await expect(
    page.getByTestId(`mobile-strip-chip-${firstTerminalId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`mobile-strip-chip-${secondTerminalId}`),
  ).toBeVisible();

  // Tap a chip to switch across groups.
  await page.getByTestId(`mobile-strip-chip-${secondTerminalId}`).click();
  await expect(
    page.getByTestId(`workspace-pane-${secondTerminalId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`workspace-pane-${firstTerminalId}`),
  ).toHaveCount(0);

  // Long-press the chip → sheet → Close terminal (no foreground process, so
  // no confirm dialog). The shell falls back to the remaining terminal.
  await longPressStripChip(page, secondTerminalId);
  await page.getByTestId("mobile-chip-close-terminal").click();
  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);
  await expect(
    page.getByTestId(`mobile-strip-chip-${secondTerminalId}`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`workspace-pane-${firstTerminalId}`),
  ).toBeVisible();
});

test("mobile Ctrl latch and pinned key-bar keys send bytes directly", async ({
  page,
}) => {
  const inputFrames: string[] = [];
  const commandFrames: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const payload = JSON.parse(frame.payload) as {
        type: string;
        data?: string;
      };
      if (payload.type === "input" && payload.data) {
        inputFrames.push(payload.data);
      }
      if (payload.type === "command_input" && payload.data) {
        commandFrames.push(payload.data);
      }
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  await createTerminalViaApi(page, { startupCommand: "sleep 600" });
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Pinned ⇧Tab / ^C send their bytes immediately, unbuffered.
  await page.getByTestId("extended-keybar-shift-tab").click();
  await page.getByTestId("extended-keybar-ctrl-c").click();
  await expect.poll(() => commandFrames).toContain("\x1b[Z");
  await expect.poll(() => commandFrames).toContain("\x03");

  // Latch Ctrl: the next soft-keyboard letter goes out as its control byte,
  // then the latch disarms and the following letter sends as-is.
  await page.getByTitle("Show keyboard").click();
  await expect
    .poll(() => terminalHasKeyboardFocus(page), { timeout: 20_000 })
    .toBe(true);
  await page.getByTestId("extended-keybar-ctrl-latch").click();
  await page.keyboard.press("c");
  await expect.poll(() => inputFrames.includes("\x03")).toBe(true);
  await page.keyboard.press("c");
  await expect.poll(() => inputFrames.includes("c")).toBe(true);
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

async function hasXtermInstance(
  page: Page,
  terminalId: string,
): Promise<boolean> {
  return page.evaluate((tid) => {
    const map = (
      window as unknown as {
        __webmuxTerminals?: Map<string, unknown>;
      }
    ).__webmuxTerminals;
    return map?.has(tid) ?? false;
  }, terminalId);
}

async function getXtermSize(
  page: Page,
  terminalId: string,
): Promise<{ cols: number; rows: number }> {
  return page.evaluate((tid) => {
    const map = (
      window as unknown as {
        __webmuxTerminals?: Map<string, { cols: number; rows: number }>;
      }
    ).__webmuxTerminals;
    const term = map?.get(tid);
    return { cols: term?.cols ?? 0, rows: term?.rows ?? 0 };
  }, terminalId);
}

async function dispatchTerminalTouchDrag(page: Page): Promise<void> {
  await getImmersiveTerminal(page)
    .locator(".xterm-screen")
    .evaluate((screen) => {
      const rect = screen.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const startY = rect.top + rect.height * 0.65;
      const endY = rect.top + rect.height * 0.35;

      function dispatch(
        type: "touchstart" | "touchmove" | "touchend",
        y: number,
      ) {
        const touch = new Touch({
          identifier: 1,
          target: screen,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
        });
        screen.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === "touchend" ? [] : [touch],
            targetTouches: type === "touchend" ? [] : [touch],
            changedTouches: [touch],
          }),
        );
      }

      dispatch("touchstart", startY);
      dispatch("touchmove", (startY + endY) / 2);
      dispatch("touchmove", endY);
      dispatch("touchend", endY);
    });
}

function parseWheelMouseFrame(
  data: string,
): { col: number; row: number } | null {
  const match = /\x1b\[<(?:64|65);(\d+);(\d+)M/.exec(data);
  if (!match) return null;
  return {
    col: Number(match[1]),
    row: Number(match[2]),
  };
}

async function terminalHasKeyboardFocus(
  page: Parameters<typeof openApp>[0],
): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.closest(".xterm") !== null;
  });
}

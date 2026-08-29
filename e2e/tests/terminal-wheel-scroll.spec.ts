import { expect, test, type Page } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  getImmersiveTerminal,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("small wheel deltas send terminal scroll input immediately", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
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
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    startupCommand: "sleep 600",
  });
  await expandTerminalById(page, terminalId);
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect.poll(() => hasXtermInstance(page, terminalId)).toBe(true);

  const screen = getImmersiveTerminal(page).locator(".xterm-screen");
  const box = await screen.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  inputFrames.length = 0;
  // With scrollSensitivity 3 a single 10px delta no longer emits a report on
  // its own — xterm accumulates sub-line wheel deltas until they cross one
  // cell height. A few lines of travel does.
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 10);
  }

  await expect.poll(() => inputFrames.some(isWheelMouseFrame)).toBe(true);
  await context.close();
});

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

function isWheelMouseFrame(data: string): boolean {
  return data.includes("\x1b[<64;") || data.includes("\x1b[<65;");
}

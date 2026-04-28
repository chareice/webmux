import { expect, test } from "@playwright/test";

import {
  createTerminalViaApi,
  expectTerminalCount,
  openApp,
  readTerminalBuffer,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

test("visible grid previews share one preview websocket", async ({ page }) => {
  const websocketUrls: string[] = [];
  let previewSubscribeFrames = 0;
  let previewBinaryFrames = 0;
  page.on("websocket", (socket) => {
    websocketUrls.push(socket.url());
    if (!socket.url().includes("/ws/terminal-previews")) return;
    socket.on("framesent", (frame) => {
      if (
        typeof frame.payload === "string" &&
        frame.payload.includes('"type":"subscribe"')
      ) {
        previewSubscribeFrames += 1;
      }
    });
    socket.on("framereceived", (frame) => {
      if (typeof frame.payload !== "string") {
        previewBinaryFrames += 1;
      }
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

  const firstMarker = `PREVIEW_MUX_A_${Date.now()}`;
  const secondMarker = `PREVIEW_MUX_B_${Date.now()}`;
  const firstId = await createTerminalViaApi(page, {
    cwd: "/tmp",
    startupCommand: `\rprintf '%s\\n' "${firstMarker}"`,
  });
  const secondId = await createTerminalViaApi(page, {
    cwd: "/tmp",
    startupCommand: `\rprintf '%s\\n' "${secondMarker}"`,
  });

  await expectTerminalCount(page, 2);
  await expect
    .poll(() => previewSubscribeFrames, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => previewBinaryFrames, { timeout: 10_000 })
    .toBeGreaterThan(0);

  await expect
    .poll(() => readTerminalBuffer(page, firstId), { timeout: 20_000 })
    .toContain(firstMarker);
  await expect
    .poll(() => readTerminalBuffer(page, secondId), { timeout: 20_000 })
    .toContain(secondMarker);

  expect(
    websocketUrls.filter((url) => url.includes("/ws/terminal-previews")),
  ).toHaveLength(1);
  expect(
    websocketUrls.filter((url) => url.includes("/ws/terminal/")),
  ).toHaveLength(0);
});

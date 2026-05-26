import { expect, test } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  expectTerminalCount,
  openApp,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

test("visible grid previews share one websocket without mounting xterm renderers", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

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

  await expect(page.getByTestId(`grid-card-${firstId}`)).toContainText(
    firstMarker,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId(`grid-card-${secondId}`)).toContainText(
    secondMarker,
    { timeout: 20_000 },
  );

  expect(
    websocketUrls.filter((url) => url.includes("/ws/terminal-previews")),
  ).toHaveLength(1);
  expect(
    websocketUrls.filter((url) => url.includes("/ws/terminal/")),
  ).toHaveLength(0);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const terminals = (
          window as unknown as { __webmuxTerminals?: Map<string, unknown> }
        ).__webmuxTerminals;
        return terminals?.size ?? 0;
      }),
    )
    .toBe(0);
});

test("zoomed workspace stops background grid preview subscriptions", async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

  let previewSubscribeFrames = 0;
  let previewUnsubscribeFrames = 0;
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal-previews")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      if (frame.payload.includes('"type":"subscribe"')) {
        previewSubscribeFrames += 1;
      }
      if (frame.payload.includes('"type":"unsubscribe"')) {
        previewUnsubscribeFrames += 1;
      }
    });
  });

  const firstId = await createTerminalViaApi(page, { cwd: "/tmp" });
  await createTerminalViaApi(page, { cwd: "/tmp" });

  await expectTerminalCount(page, 2);
  await expect
    .poll(() => previewSubscribeFrames, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);

  await expandTerminalById(page, firstId);

  await expect
    .poll(() => previewUnsubscribeFrames, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
});

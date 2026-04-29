import { expect, test, type Page, type WebSocket } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  getImmersiveTerminal,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("duplicate browser image paste events send one image_paste frame", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const imagePasteFrames: unknown[] = [];

  page.on("websocket", (socket: WebSocket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const payload = JSON.parse(frame.payload) as { type?: string };
      if (payload.type === "image_paste") {
        imagePasteFrames.push(payload);
      }
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, terminalId);
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await focusTerminal(page, terminalId);
  await dispatchClipboardImagePaste(page);
  await expect.poll(() => imagePasteFrames.length).toBe(1);
  await dispatchClipboardImagePaste(page);

  await page.waitForTimeout(500);
  expect(imagePasteFrames).toHaveLength(1);

  await context.close();
});

async function focusTerminal(page: Page, terminalId: string): Promise<void> {
  await page.evaluate((tid) => {
    const map = (
      window as unknown as { __webmuxTerminals?: Map<string, { focus: () => void }> }
    ).__webmuxTerminals;
    map?.get(tid)?.focus();
  }, terminalId);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document
            .querySelector("[data-terminal-display-mode='immersive']")
            ?.contains(document.activeElement),
      ),
    )
    .toBe(true);
}

async function dispatchClipboardImagePaste(page: Page): Promise<void> {
  await page.evaluate(() => {
    const immersive = document.querySelector(
      "[data-terminal-display-mode='immersive']",
    );
    if (!immersive) throw new Error("immersive terminal is not mounted");

    const target =
      immersive.querySelector(".xterm-helper-textarea") ??
      immersive.querySelector(".xterm") ??
      immersive;

    const data = new DataTransfer();
    data.items.add(
      new File(["webmux-image-paste"], "paste.png", { type: "image/png" }),
    );
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

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

// Scrollback lives in tmux copy-mode: wheel-up enters it (`copy-mode -e`) and
// scrolling back to the bottom exits it. Trackpads emit a few-pixel backward
// wobble when the finger lifts; amplified by xterm's scrollSensitivity that
// wobble becomes a wheel-up mouse report which instantly re-enters copy-mode,
// so the "[0/N]" position badge never clears no matter how the user scrolls.
test("trackpad scroll back to bottom exits tmux copy-mode despite lift-off jitter", async ({
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
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    // seq builds scrollback history so copy-mode has lines to scroll into
    startupCommand: "bash -c 'seq 1 200; exec sleep 600'",
  });
  await expandTerminalById(page, terminalId);
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect.poll(() => hasXtermInstance(page, terminalId)).toBe(true);
  await expect
    .poll(() => readTerminalText(page, terminalId), { timeout: 10_000 })
    .toContain("200");

  const screen = getImmersiveTerminal(page).locator(".xterm-screen");
  const box = await screen.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // Deliberate trackpad scroll up: enters copy-mode, badge appears
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -15);
  }
  await expect
    .poll(() => hasCopyModeBadge(page, terminalId), { timeout: 5_000 })
    .toBe(true);

  // Scroll back down to the bottom… ending with the small upward wobble a
  // trackpad emits as the finger lifts off.
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 15);
  }
  await page.mouse.wheel(0, -7);
  await page.mouse.wheel(0, -7);
  await page.mouse.wheel(0, -6);

  // Copy-mode must stay exited: the badge clears and does not come back.
  await expect
    .poll(() => hasCopyModeBadge(page, terminalId), { timeout: 5_000 })
    .toBe(false);
  await page.waitForTimeout(500);
  expect(await hasCopyModeBadge(page, terminalId)).toBe(false);

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

async function readTerminalText(
  page: Page,
  terminalId: string,
): Promise<string> {
  return page.evaluate((tid) => {
    type XtermLike = {
      rows: number;
      buffer: {
        active: {
          getLine(y: number): { translateToString(trim: boolean): string } | undefined;
        };
      };
    };
    const map = (
      window as unknown as {
        __webmuxTerminals?: Map<string, XtermLike>;
      }
    ).__webmuxTerminals;
    const term = map?.get(tid);
    if (!term) return "";
    const lines: string[] = [];
    for (let y = 0; y < term.rows; y++) {
      lines.push(term.buffer.active.getLine(y)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }, terminalId);
}

// tmux draws its copy-mode position indicator ("[12/163]") in the top-right
// corner of the pane, which is the first row of the terminal buffer here.
async function hasCopyModeBadge(
  page: Page,
  terminalId: string,
): Promise<boolean> {
  const text = await readTerminalText(page, terminalId);
  const topRow = text.split("\n")[0] ?? "";
  return /\[\d+\/\d+\]\s*$/.test(topRow);
}

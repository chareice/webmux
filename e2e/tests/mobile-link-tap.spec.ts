import { test, expect, devices } from "@playwright/test";

import {
  createTerminalViaApi,
  listTerminals,
  mobileTakeControl,
  openApp,
  readTerminalBuffer,
  resetMachineState,
} from "./helpers";

test.use({
  ...devices["iPhone 14"],
  browserName: "chromium",
});

const LINK = "https://example.com/tapme";

// Terminal links are activated by xterm's Linkifier, which only listens for
// mouse events. On touch those arrive as the compatibility events a tap
// synthesises, and the terminal's own touch handlers (scroll-to-wheel
// translation) must not swallow them.
test("tapping a terminal hyperlink on touch opens it", async ({ page }) => {
  await page.context().addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    const original = window.open;
    window.open = (url?: string | URL, ...rest: unknown[]) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return original.call(window, url as string, ...(rest as []));
    };
  });

  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
  await createTerminalViaApi(page, {
    startupCommand: `printf 'go ${LINK}\\n'`,
  });

  const [terminal] = await listTerminals(page);
  expect(terminal).toBeDefined();

  await expect
    .poll(async () => await readTerminalBuffer(page, terminal.id), {
      timeout: 15_000,
    })
    .toContain(LINK);

  // Locate the URL on screen through the terminal buffer + cell metrics.
  // The WebGL renderer paints text onto canvases, so there are no DOM text
  // rows to search — the buffer is the renderer-agnostic source of truth.
  const target = await page.evaluate((link) => {
    const screen = document.querySelector(".xterm-screen") as HTMLElement;
    const screenRect = screen.getBoundingClientRect();
    const terminals = (
      window as unknown as {
        __offdeskTerminals?: Map<
          string,
          {
            cols: number;
            rows: number;
            buffer: {
              active: {
                viewportY: number;
                getLine(
                  y: number,
                ): { translateToString(trim: boolean): string } | undefined;
              };
            };
          }
        >;
      }
    ).__offdeskTerminals;
    const term = terminals?.values().next().value;
    if (!term) return null;
    const cellWidth = screenRect.width / term.cols;
    const cellHeight = screenRect.height / term.rows;
    const buffer = term.buffer.active;
    for (let rowIndex = 0; rowIndex < term.rows; rowIndex++) {
      const text =
        buffer.getLine(buffer.viewportY + rowIndex)?.translateToString(true) ??
        "";
      const index = text.indexOf(link);
      if (index < 0) continue;
      return {
        // Aim at the middle of the link text, not its first character.
        x: Math.round(screenRect.left + cellWidth * (index + link.length / 2)),
        y: Math.round(screenRect.top + cellHeight * (rowIndex + 0.5)),
      };
    }
    return null;
  }, LINK);
  expect(target, "link text not found on screen").not.toBeNull();

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd"
          ? []
          : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
    });
  await touch("touchStart", target!.x, target!.y);
  await page.waitForTimeout(60);
  await touch("touchEnd", target!.x, target!.y);

  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => (window as unknown as { __opened: string[] }).__opened,
        ),
      { timeout: 5_000 },
    )
    .toContain(LINK);
});

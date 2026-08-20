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

  // Locate the URL on screen: xterm renders rows as absolutely positioned
  // divs, so the row rect plus a cell-width estimate gives a tap point
  // inside the link text.
  const target = await page.evaluate((link) => {
    const screen = document.querySelector(".xterm-screen") as HTMLElement;
    const screenRect = screen.getBoundingClientRect();
    const terminals = (
      window as unknown as { __webmuxTerminals?: Map<string, { cols: number }> }
    ).__webmuxTerminals;
    const cols = terminals?.values().next().value?.cols ?? 80;
    const cellWidth = screenRect.width / cols;
    for (const row of Array.from(
      document.querySelectorAll(".xterm-rows > div"),
    ) as HTMLElement[]) {
      const index = (row.textContent ?? "").indexOf(link);
      if (index < 0) continue;
      const rowRect = row.getBoundingClientRect();
      return {
        // Aim at the middle of the link text, not its first character.
        x: Math.round(screenRect.left + cellWidth * (index + link.length / 2)),
        y: Math.round(rowRect.top + rowRect.height / 2),
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

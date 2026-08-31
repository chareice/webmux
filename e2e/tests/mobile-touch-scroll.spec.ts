import { test, expect, devices } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  getImmersiveTerminal,
  mobileTakeControl,
  openApp,
  readTerminalBuffer,
  resetMachineState,
} from "./helpers";

test.use({
  ...devices["iPhone 14"],
  browserName: "chromium",
});

// Touch scrolling must go through Chromium's real input pipeline (CDP
// Input.dispatchTouchEvent): the app's touch handlers translate finger
// travel into synthetic wheel events for xterm, and hand-dispatched DOM
// TouchEvents would not exercise the same defaults (preventDefault, compat
// mouse events) as trusted ones.
//
// Scroll positions are read from the tmux copy-mode badge ("[x/y]") that
// tmux draws on the top row of the pane — x is the number of lines scrolled
// into history.

const SCROLLBACK_LINES = 300;

interface TouchCapableWindow {
  __offdeskTerminals?: Map<
    string,
    {
      rows: number;
      options: { fontSize?: number; lineHeight?: number };
      _core?: {
        _renderService?: {
          dimensions?: { css?: { cell?: { width: number; height: number } } };
        };
      };
    }
  >;
}

// The app's scrollByPixels quantizes finger travel with the measured CSS
// cell height (falling back to fontSize * lineHeight) — use exactly that as
// px-per-line so drag distances land on the same grid the implementation
// uses.
async function readPxPerLine(page: Page, terminalId: string): Promise<number> {
  const pxPerLine = await page.evaluate((tid) => {
    const term = (
      window as unknown as TouchCapableWindow
    ).__offdeskTerminals?.get(tid);
    if (!term) return null;
    return (
      term._core?._renderService?.dimensions?.css?.cell?.height ??
      (term.options.fontSize ?? 14) * (term.options.lineHeight ?? 1)
    );
  }, terminalId);
  expect(pxPerLine).not.toBeNull();
  return pxPerLine!;
}

async function readScrollPosition(
  page: Page,
  terminalId: string,
): Promise<number | null> {
  const text = await readTerminalBuffer(page, terminalId);
  const topRow = text.split("\n")[0] ?? "";
  const match = topRow.match(/\[(\d+)\/\d+\]\s*$/);
  return match ? Number(match[1]) : null;
}

async function terminalCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await getImmersiveTerminal(page)
    .locator(".xterm-screen")
    .boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

async function dispatchTouch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      type === "touchEnd"
        ? []
        : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
  });
}

// Drag the finger DOWN: in natural touch scrolling that pulls older content
// into view — the app turns it into wheel-up reports, entering tmux
// copy-mode and scrolling into history.
// Fast swipe that stays inside .xterm-screen. CDP round-trips are ~50ms
// each, so 4 moves across the pane still clear the 0.4 px/ms fling
// threshold; 8×16ms over 20 line-heights starts above the pane on a
// short iPhone viewport and the touchstart misses.
async function fling(page: Page, cdp: CDPSession): Promise<{ x: number; y: number }> {
  const box = await getImmersiveTerminal(page)
    .locator(".xterm-screen")
    .boundingBox();
  expect(box).not.toBeNull();
  const inset = 12;
  await drag(page, cdp, {
    fromY: box!.y + inset,
    distancePx: Math.max(8, box!.height - 2 * inset),
    moves: 4,
    stepMs: 16,
  });
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

async function drag(
  page: Page,
  cdp: CDPSession,
  opts: { fromY: number; distancePx: number; moves: number; stepMs: number },
): Promise<{ x: number; endY: number }> {
  const { x } = await terminalCenter(page);
  const startY = opts.fromY;
  await dispatchTouch(cdp, "touchStart", x, startY);
  for (let i = 1; i <= opts.moves; i++) {
    await page.waitForTimeout(opts.stepMs);
    await dispatchTouch(
      cdp,
      "touchMove",
      x,
      startY + (opts.distancePx * i) / opts.moves,
    );
  }
  await dispatchTouch(cdp, "touchEnd", x, startY + opts.distancePx);
  return { x, endY: startY + opts.distancePx };
}

async function pollPositions(
  page: Page,
  terminalId: string,
  count: number,
  intervalMs: number,
): Promise<(number | null)[]> {
  const samples: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    samples.push(await readScrollPosition(page, terminalId));
    if (i < count - 1) await page.waitForTimeout(intervalMs);
  }
  return samples;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
});

async function setupScrolledTerminal(page: Page): Promise<string> {
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    // seq builds scrollback history so copy-mode has lines to scroll into
    startupCommand: `bash -c 'seq 1 ${SCROLLBACK_LINES}; exec sleep 600'`,
  });
  await expandTerminalById(page, terminalId);
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect
    .poll(() => readTerminalBuffer(page, terminalId), { timeout: 15_000 })
    .toContain(String(SCROLLBACK_LINES));
  return terminalId;
}

test("slow drag tracks finger travel ~1:1 in lines", async ({ page }) => {
  const terminalId = await setupScrolledTerminal(page);
  const cdp = await page.context().newCDPSession(page);
  const pxPerLine = await readPxPerLine(page, terminalId);
  const { y: centerY } = await terminalCenter(page);

  // 5 lines over ~320ms ≈ 0.22 px/ms — comfortably below the 0.4 px/ms
  // momentum threshold, so nothing keeps scrolling after the finger lifts.
  const lines = 5;
  await drag(page, cdp, {
    fromY: centerY - 40,
    distancePx: lines * pxPerLine,
    moves: 8,
    stepMs: 40,
  });

  await expect
    .poll(() => readScrollPosition(page, terminalId), { timeout: 10_000 })
    .not.toBeNull();
  const position = await readScrollPosition(page, terminalId);
  expect(position).not.toBeNull();
  expect(Math.abs(position! - lines)).toBeLessThanOrEqual(2);

  // No momentum: the position must already be settled.
  const settled = await pollPositions(page, terminalId, 3, 150);
  expect(new Set(settled).size).toBe(1);
});

test("fast fling keeps scrolling after the finger lifts, then settles", async ({
  page,
}) => {
  const terminalId = await setupScrolledTerminal(page);
  const cdp = await page.context().newCDPSession(page);

  await fling(page, cdp);

  const atRelease = await readScrollPosition(page, terminalId);

  // Momentum: the position must keep advancing with the finger gone.
  const samples = await pollPositions(page, terminalId, 25, 120);
  const peak = Math.max(
    ...samples.map((sample) => sample ?? -1),
    atRelease ?? -1,
  );
  expect(
    peak,
    `scroll position did not advance after touchend (at release: ${atRelease}, samples: ${samples.join(",")})`,
  ).toBeGreaterThan(atRelease ?? 0);

  // …then it settles: two consecutive equal polls at the end.
  const tail = samples.slice(-2);
  expect(tail[0]).not.toBeNull();
  expect(tail[0]).toBe(tail[1]);
});

test("a tap mid-fling stops the glide without exiting copy-mode", async ({
  page,
}) => {
  const terminalId = await setupScrolledTerminal(page);
  const cdp = await page.context().newCDPSession(page);
  const { x, y: centerY } = await fling(page, cdp);

  // Let the glide start, then tap to stop it. The tap lands on plain text
  // (seq output — no links), so it must not activate anything.
  await page.waitForTimeout(250);
  await dispatchTouch(cdp, "touchStart", x, centerY);
  await page.waitForTimeout(60);
  await dispatchTouch(cdp, "touchEnd", x, centerY);

  // Freeze: within a few polls the position stops moving…
  const samples = await pollPositions(page, terminalId, 12, 120);
  const tail = samples.slice(-2);
  expect(tail[0]).not.toBeNull();
  expect(
    tail[0],
    `scroll position did not freeze after the tap (samples: ${samples.join(",")})`,
  ).toBe(tail[1]);

  // …copy-mode is NOT exited (badge still present)…
  expect(tail[0]).not.toBeNull();

  // …and nothing else on screen changes afterwards (badge row excluded —
  // its position numbers may still have been in flight at tap time).
  const afterFreeze = await readTerminalBuffer(page, terminalId);
  await page.waitForTimeout(400);
  const later = await readTerminalBuffer(page, terminalId);
  expect(later.split("\n").slice(1)).toEqual(afterFreeze.split("\n").slice(1));
});

test("scroll position is stable at rest after a fling settles", async ({
  page,
}) => {
  const terminalId = await setupScrolledTerminal(page);
  const cdp = await page.context().newCDPSession(page);

  await fling(page, cdp);

  // Wait for the glide to die out, then poll: no overshoot jitter, no
  // wheel-gate/copy-mode re-entry wobble.
  await page.waitForTimeout(2_500);
  const samples = await pollPositions(page, terminalId, 5, 150);
  expect(samples[0]).not.toBeNull();
  expect(
    new Set(samples).size,
    `scroll position not stable at rest: ${samples.join(",")}`,
  ).toBe(1);
});

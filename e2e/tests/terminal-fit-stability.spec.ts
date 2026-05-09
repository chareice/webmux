import { expect, test, type Page } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  resetMachineState,
  selectHomeWorkpath,
  takeControlFromHeader,
} from "./helpers";

test("desktop Fit reaches a stable terminal size after one click", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const resizeFrames: Array<{ cols: number; rows: number }> = [];

  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const payload = JSON.parse(frame.payload) as
        | { type: "resize"; cols: number; rows: number }
        | { type: string };
      if (payload.type === "resize") {
        resizeFrames.push({ cols: payload.cols, rows: payload.rows });
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
  await expect.poll(() => getLocalTerminalSize(page, terminalId)).toEqual({
    cols: 80,
    rows: 24,
  });

  await page.getByLabel("Fit", { exact: true }).click();
  await expect.poll(() => resizeFrames.length).toBe(1);
  const first = resizeFrames[0];
  await expect.poll(() => getLocalTerminalSize(page, terminalId)).toEqual(first);

  await page.getByLabel("Fit", { exact: true }).click();
  await expect.poll(() => resizeFrames.length).toBe(2);

  expect(resizeFrames[1]).toEqual(first);
  await context.close();
});

// Regression for "每次点击 fit 终端尺寸都跳" — rapid back-to-back clicks.
// The previous implementation reverse-engineered cell width from a cached
// surface measurement (which lagged term.cols by one RAF), so clicks fired
// before the cache caught up produced wildly different dimensions. With
// cell metrics read directly from xterm, every click is a pure projection of
// viewport onto cell size and converges in one shot.
test("rapid Fit clicks all produce the same terminal size", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const resizeFrames: Array<{ cols: number; rows: number }> = [];

  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws/terminal/")) return;
    socket.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") return;
      const payload = JSON.parse(frame.payload) as
        | { type: "resize"; cols: number; rows: number }
        | { type: string };
      if (payload.type === "resize") {
        resizeFrames.push({ cols: payload.cols, rows: payload.rows });
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
  await expect.poll(() => getLocalTerminalSize(page, terminalId)).toEqual({
    cols: 80,
    rows: 24,
  });

  // Dispatch five clicks back-to-back in a single microtask. The previous
  // implementation needed a few RAFs between clicks to settle its cached
  // surface size; doing them all in one frame would cascade stale reads
  // and produce divergent resize messages.
  const fit = page.getByLabel("Fit", { exact: true });
  await fit.evaluate((node: Element) => {
    const button = node as HTMLButtonElement;
    for (let i = 0; i < 5; i++) {
      button.click();
    }
  });

  await expect.poll(() => resizeFrames.length).toBe(5);
  const first = resizeFrames[0];
  for (const frame of resizeFrames) {
    expect(frame).toEqual(first);
  }
  await context.close();
});

test("immersive terminal scales tall sessions to the available height", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 520 } });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);
  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    cols: 80,
    rows: 80,
  });
  await expandTerminalById(page, terminalId);
  await expect(getImmersiveTerminal(page)).toBeVisible();

  await expect
    .poll(async () => {
      const layout = await readTerminalLayout(page, terminalId);
      if (!layout.root || !layout.frame || !layout.term) return false;
      return (
        layout.term.rows === 80 &&
        Number(layout.attrs.scale) < 1 &&
        layout.frame.height <= layout.root.height + 1 &&
        layout.frame.width <= layout.root.width + 1
      );
    })
    .toBe(true);

  await context.close();
});

test("desktop thumbnail switch fits the newly focused terminal to the overlay", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const firstId = await createTerminalViaApi(page, {
    cwd: "/root",
    cols: 80,
    rows: 24,
  });
  const compactId = await createTerminalViaApi(page, {
    cwd: "/root",
    cols: 164,
    rows: 16,
  });

  await expandTerminalById(page, firstId);
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect
    .poll(async () => terminalSize(page, compactId))
    .toEqual({ cols: 164, rows: 16 });

  await page.getByTestId(`expanded-thumb-${compactId}`).click();

  await expect
    .poll(async () => {
      const size = await terminalSize(page, compactId);
      return size?.rows ?? 0;
    })
    .toBeGreaterThan(16);

  await context.close();
});

async function getLocalTerminalSize(
  page: Page,
  terminalId: string,
): Promise<{ cols: number; rows: number } | null> {
  return page.evaluate((tid) => {
    const map = (
      window as unknown as {
        __webmuxTerminals?: Map<string, { cols: number; rows: number }>;
      }
    ).__webmuxTerminals;
    const terminal = map?.get(tid);
    if (!terminal) return null;
    return { cols: terminal.cols, rows: terminal.rows };
  }, terminalId);
}

async function readTerminalLayout(page: Page, terminalId: string): Promise<{
  term: { cols: number; rows: number } | null;
  attrs: { scale: string | null; justify: string | null };
  root: Rect | null;
  frame: Rect | null;
  scaledSurface: Rect | null;
  container: Rect | null;
  xterm: Rect | null;
  screen: Rect | null;
  canvas: Rect | null;
  scroll: {
    screenClientWidth: number;
    screenClientHeight: number;
    screenScrollWidth: number;
    screenScrollHeight: number;
    xtermClientWidth: number | null;
    xtermClientHeight: number | null;
    canvasWidth: number | null;
    canvasHeight: number | null;
  } | null;
}> {
  return page.evaluate((tid) => {
    const root = document.querySelector(
      "[data-terminal-display-mode='immersive']",
    ) as HTMLElement | null;
    const xterm = root?.querySelector(".xterm") as HTMLElement | null;
    const screen = root?.querySelector(".xterm-screen") as HTMLElement | null;
    const canvas = root?.querySelector(
      ".xterm-screen canvas",
    ) as HTMLCanvasElement | null;
    const container = xterm?.parentElement as HTMLElement | null;
    const frame = container?.parentElement as HTMLElement | null;
    const scaledSurface = frame?.firstElementChild as HTMLElement | null;
    const map = (
      window as unknown as {
        __webmuxTerminals?: Map<string, { cols: number; rows: number }>;
      }
    ).__webmuxTerminals;
    const terminal = map?.get(tid);
    const rect = (element: Element | null) => {
      const box = element?.getBoundingClientRect();
      if (!box) return null;
      return {
        x: Math.round(box.x * 100) / 100,
        y: Math.round(box.y * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      };
    };
    return {
      term: terminal
        ? {
            cols: terminal.cols,
            rows: terminal.rows,
          }
        : null,
      attrs: {
        scale: root?.getAttribute("data-terminal-view-scale"),
        justify: root?.getAttribute("data-terminal-view-justify"),
      },
      root: rect(root),
      frame: rect(frame),
      scaledSurface: rect(scaledSurface),
      container: rect(container),
      xterm: rect(xterm),
      screen: rect(screen),
      canvas: rect(canvas),
      scroll: screen
        ? {
            screenClientWidth: screen.clientWidth,
            screenClientHeight: screen.clientHeight,
            screenScrollWidth: screen.scrollWidth,
            screenScrollHeight: screen.scrollHeight,
            xtermClientWidth: xterm?.clientWidth ?? null,
            xtermClientHeight: xterm?.clientHeight ?? null,
            canvasWidth: canvas?.width ?? null,
            canvasHeight: canvas?.height ?? null,
          }
        : null,
    };
  }, terminalId);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function terminalSize(
  page: Page,
  terminalId: string,
): Promise<{ cols: number; rows: number } | null> {
  const terminal = (await listTerminals(page)).find((t) => t.id === terminalId);
  if (!terminal) return null;
  return {
    cols: terminal.cols,
    rows: terminal.rows,
  };
}

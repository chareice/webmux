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

test("live terminal keeps xterm glyphs for progress blocks", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await selectHomeWorkpath(page);

  const terminalId = await createTerminalViaApi(page, {
    cwd: "/root",
    startupCommand: "printf '[████████████░░] 78%\\n'; sleep 600",
  });
  await expandTerminalById(page, terminalId);
  await expect(getImmersiveTerminal(page)).toBeVisible();
  await expect
    .poll(async () => readTerminalLine(page, terminalId, 0))
    .toContain("78%");

  await expect
    .poll(async () => readCustomGlyphsOption(page, terminalId))
    .toBe(true);

  await expect
    .poll(async () => readVisibleXtermScrollbarCount(page), { timeout: 5_000 })
    .toBe(0);

  // The live terminal must actually be on the WebGL renderer in the
  // standardized runner browser (SwiftShader provides WebGL there). A
  // silent fallback to the DOM renderer would pass every other assertion
  // while giving up an order of magnitude of output throughput. The
  // WebGL addon renders into <canvas> layers inside .xterm; the DOM
  // renderer creates none.
  await expect
    .poll(async () => readXtermCanvasCount(page), { timeout: 5_000 })
    .toBeGreaterThan(0);
});

async function readXtermCanvasCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll(".xterm canvas").length,
  );
}

async function readCustomGlyphsOption(
  page: Page,
  terminalId: string,
): Promise<boolean | undefined> {
  return page.evaluate((tid) => {
    const map = (
      window as unknown as {
        __webmuxTerminals?: Map<
          string,
          { options: { customGlyphs?: boolean } }
        >;
      }
    ).__webmuxTerminals;
    return map?.get(tid)?.options.customGlyphs;
  }, terminalId);
}

async function readTerminalLine(
  page: Page,
  terminalId: string,
  row: number,
): Promise<string> {
  return page.evaluate(
    ({ tid, rowIndex }) => {
      const map = (
        window as unknown as {
          __webmuxTerminals?: Map<
            string,
            {
              buffer: {
                active: {
                  getLine: (
                    index: number,
                  ) =>
                    | { translateToString: (trimRight: boolean) => string }
                    | undefined;
                };
              };
            }
          >;
        }
      ).__webmuxTerminals;
      return (
        map
          ?.get(tid)
          ?.buffer.active.getLine(rowIndex)
          ?.translateToString(true) ?? ""
      );
    },
    { tid: terminalId, rowIndex: row },
  );
}

async function readVisibleXtermScrollbarCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return Array.from(
      document.querySelectorAll(
        "[data-terminal-display-mode='immersive'] .xterm .xterm-scrollable-element > .scrollbar",
      ),
    ).filter((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }).length;
  });
}

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

test("live terminal renders block glyphs through the configured font", async ({
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
    .toBe(false);
});

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

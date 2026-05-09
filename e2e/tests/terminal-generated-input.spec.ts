import { expect, test } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  openApp,
  resetMachineState,
  takeControlFromHeader,
} from "./helpers";

async function waitForRendererReady(
  page: import("@playwright/test").Page,
  terminalId: string,
): Promise<void> {
  await page.waitForFunction(
    (id) =>
      (
        window as unknown as {
          __webmuxTerminals?: Map<string, { write: (data: string) => void }>;
        }
      ).__webmuxTerminals?.has(id),
    terminalId,
  );
}

test("browser-generated terminal attribute responses are not typed into the shell", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalSend = WebSocket.prototype.send;
    (
      window as unknown as {
        __webmuxInputFrames?: Array<{ data: string; codes: number[] }>;
        __webmuxRawTerminalData?: Array<{ data: string; codes: number[] }>;
      }
    ).__webmuxInputFrames = [];
    (
      window as unknown as {
        __webmuxRawTerminalData?: Array<{ data: string; codes: number[] }>;
      }
    ).__webmuxRawTerminalData = [];
    WebSocket.prototype.send = function patchedSend(data) {
      try {
        const message = JSON.parse(String(data)) as {
          type?: string;
          data?: string;
        };
        if (message.type === "input" && typeof message.data === "string") {
          (
            window as unknown as {
              __webmuxInputFrames: Array<{ data: string; codes: number[] }>;
            }
          ).__webmuxInputFrames.push({
            data: message.data,
            codes: Array.from(message.data).map((ch) => ch.charCodeAt(0)),
          });
        }
      } catch {
        /* ignore non-JSON websocket frames */
      }
      return originalSend.call(this, data);
    };
  });
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, terminalId);
  await waitForRendererReady(page, terminalId);
  await page.evaluate((id) => {
    (
      window as unknown as {
        __webmuxTerminals?: Map<
          string,
          {
            onData: (
              listener: (data: string) => void,
            ) => { dispose: () => void };
          }
        >;
      }
    ).__webmuxTerminals
      ?.get(id)
      ?.onData((data) => {
        (
          window as unknown as {
            __webmuxRawTerminalData?: Array<{
              data: string;
              codes: number[];
            }>;
          }
        ).__webmuxRawTerminalData?.push({
          data,
          codes: Array.from(data).map((ch) => ch.charCodeAt(0)),
        });
      });
  }, terminalId);

  await page.evaluate(() => {
    (
      window as unknown as {
        __webmuxInputFrames?: Array<{ data: string; codes: number[] }>;
        __webmuxRawTerminalData?: Array<{ data: string; codes: number[] }>;
      }
    ).__webmuxInputFrames = [];
    (
      window as unknown as {
        __webmuxRawTerminalData?: Array<{ data: string; codes: number[] }>;
      }
    ).__webmuxRawTerminalData = [];
  });
  await page.evaluate((id) => {
    (
      window as unknown as {
        __webmuxTerminals?: Map<string, { write: (data: string) => void }>;
      }
    ).__webmuxTerminals?.get(id)?.write("\x1b[>c");
  }, terminalId);
  await page.waitForTimeout(100);

  const rawTerminalData = await page.evaluate(() =>
    (
      window as unknown as {
        __webmuxRawTerminalData?: Array<{ data: string; codes: number[] }>;
      }
    ).__webmuxRawTerminalData ?? [],
  );
  expect(rawTerminalData.map((frame) => frame.data).join("")).toMatch(
    /\x1b\[[?>][0-9;]*c/,
  );

  const inputFrames = await page.evaluate(() =>
    (
      window as unknown as {
        __webmuxInputFrames?: Array<{ data: string; codes: number[] }>;
      }
    ).__webmuxInputFrames ?? [],
  );
  expect(inputFrames.map((frame) => frame.data).join("")).not.toMatch(
    /\x1b\[[?>][0-9;]*c/,
  );
});

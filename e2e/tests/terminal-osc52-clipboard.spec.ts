import { expect, test } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  openApp,
  resetMachineState,
  takeControlFromHeader,
} from "./helpers";

test("OSC 52 clipboard writes use the Tauri clipboard bridge when available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __offdeskTauriClipboardWrites: string[] })
      .__offdeskTauriClipboardWrites = writes;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new Error("browser clipboard should not be used")),
        readText: () => Promise.resolve("browser clipboard"),
      },
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);
  await page.evaluate(() => {
    const writes = (
      window as unknown as { __offdeskTauriClipboardWrites: string[] }
    ).__offdeskTauriClipboardWrites;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: (cmd: string, args?: { text?: string }) => {
          if (cmd === "plugin:clipboard-manager|write_text") {
            writes.push(args?.text ?? "");
            return Promise.resolve();
          }
          if (cmd === "plugin:clipboard-manager|read_text") {
            return Promise.resolve(writes[writes.length - 1] ?? "");
          }
          return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
        },
      },
    });
  });

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, terminalId);
  await page.waitForFunction(
    (id) =>
      (
        window as unknown as {
          __offdeskTerminals?: Map<string, unknown>;
        }
      ).__offdeskTerminals?.has(id),
    terminalId,
  );

  const marker = `OSC52-TAURI-${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate(
    ({ id, text }) => {
      const term = (
        window as unknown as {
          __offdeskTerminals?: Map<string, { write: (data: string) => void }>;
        }
      ).__offdeskTerminals?.get(id);
      if (!term) throw new Error("terminal not found in __offdeskTerminals");
      term.write(`\x1b]52;c;${btoa(text)}\x07`);
    },
    { id: terminalId, text: marker },
  );

  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __offdeskTauriClipboardWrites: string[];
              }
            ).__offdeskTauriClipboardWrites.join("\n"),
        ),
      { timeout: 5_000 },
    )
    .toContain(marker);
});

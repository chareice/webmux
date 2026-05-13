import { expect, test } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  openApp,
  resetMachineState,
  takeControlFromHeader,
} from "./helpers";

// Regression test for the desktop copy-on-select bug where releasing the
// mouse OUTSIDE the terminal container left the clipboard untouched. The
// xterm SelectionService listens on `document` (so dragging out of the
// viewport still completes the selection); webmux now mirrors that pattern
// by attaching the mouseup listener to `document` from a mousedown inside
// the terminal — see TerminalView.xterm.tsx.
//
// We don't rely on Chromium's real navigator.clipboard here because the
// e2e hub is served over plain http:// (insecure context), and headless
// Chromium hides clipboard APIs entirely under those conditions. Instead
// the test installs an in-memory stub via addInitScript and asserts the
// app called writeText with the selected text.

test("copy-on-select writes clipboard even when mouse is released outside the terminal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __webmuxClipboardWrites: string[] }).__webmuxClipboardWrites =
      writes;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
        readText: () =>
          Promise.resolve(writes.length > 0 ? writes[writes.length - 1] : ""),
      },
    });
  });

  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const terminalId = await createTerminalViaApi(page, { cwd: "/root" });
  await expandTerminalById(page, terminalId);
  await page.waitForFunction(
    (id) =>
      (
        window as unknown as {
          __webmuxTerminals?: Map<string, unknown>;
        }
      ).__webmuxTerminals?.has(id),
    terminalId,
  );

  const marker = `COPY-MARKER-${Math.random().toString(36).slice(2, 8)}`;

  // Disable mouse tracking so the SelectionService is enabled and selectAll
  // / hasSelection work the way they do for users on a normal shell prompt.
  // Then write a recognizable marker into the buffer and select it.
  await page.evaluate(
    ({ id, text }) => {
      const term = (
        window as unknown as {
          __webmuxTerminals?: Map<
            string,
            {
              write: (data: string) => void;
              selectAll: () => void;
              hasSelection: () => boolean;
              getSelection: () => string;
            }
          >;
        }
      ).__webmuxTerminals?.get(id);
      if (!term) throw new Error("terminal not found in __webmuxTerminals");
      term.write("\x1b[?1003l\x1b[?1006l");
      term.write(text);
      term.selectAll();
    },
    { id: terminalId, text: marker },
  );

  await page.waitForFunction(
    (id) => {
      const term = (
        window as unknown as {
          __webmuxTerminals?: Map<
            string,
            { hasSelection: () => boolean; getSelection: () => string }
          >;
        }
      ).__webmuxTerminals?.get(id);
      return !!term && term.hasSelection() && term.getSelection().length > 0;
    },
    terminalId,
  );

  // Reset captured writes so we only assert against post-selection writes.
  await page.evaluate(() => {
    (
      window as unknown as { __webmuxClipboardWrites: string[] }
    ).__webmuxClipboardWrites.length = 0;
  });

  // Reproduce the bug scenario: mousedown lands inside the terminal
  // container; mouseup lands OUTSIDE it (we use document.body). With the
  // pre-fix code the container-scoped mouseup listener never fired, so
  // writeText was never called.
  await page.evaluate(() => {
    const container = document.querySelector(
      "[data-testid^='terminal-card-'] .xterm",
    )?.parentElement;
    if (!container) throw new Error("terminal container not found");
    container.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    document.body.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, button: 0 }),
    );
  });

  // Give the async clipboardWrite a moment to resolve, then assert the
  // app called writeText with the selected text.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __webmuxClipboardWrites: string[];
              }
            ).__webmuxClipboardWrites.join("\n"),
        ),
      { timeout: 5_000 },
    )
    .toContain(marker);
});

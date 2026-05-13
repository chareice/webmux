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

test.use({
  // Chromium needs explicit permission for navigator.clipboard.{read,write}Text
  // when invoked from JS; without these the writeText call rejects silently.
  permissions: ["clipboard-read", "clipboard-write"],
});

test("copy-on-select writes clipboard even when mouse is released outside the terminal", async ({
  page,
}) => {
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

  // Wait for the renderer to settle and selection to register.
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

  // Pre-poison the clipboard so we can detect the (buggy) "old content"
  // case. With the bug, this stale value would still be in the clipboard
  // after the simulated drag-release-outside.
  const stalePayload = "STALE-CLIPBOARD-CONTENT";
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    stalePayload,
  );

  // Reproduce the bug scenario: mousedown lands inside the terminal
  // container; mouseup lands OUTSIDE it (we use document.body). With the
  // old code the container-scoped mouseup listener never fired, so
  // clipboard stayed at STALE-CLIPBOARD-CONTENT.
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

  // Give the async clipboardWrite a moment to resolve.
  await expect
    .poll(
      async () =>
        page.evaluate(() => navigator.clipboard.readText()),
      { timeout: 5_000 },
    )
    .toContain(marker);

  // Sanity check: the stale poison should be gone — i.e. we actually
  // overwrote the clipboard, not just appended.
  const finalClipboard = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(finalClipboard).not.toBe(stalePayload);
});

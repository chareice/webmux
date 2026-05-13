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
// What this test isolates is the event-wiring contract:
//
//   mousedown inside terminal container  +  mouseup anywhere on document
//     → clipboardWrite(term.getSelection())
//
// Both navigator.clipboard and term.{hasSelection,getSelection} are
// stubbed so the test doesn't depend on a) Chromium's secure-context
// rules (the e2e hub is plain http://) or b) timing of shell output
// writing to the xterm buffer (varies between local and CI).

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

  // Stub the xterm Terminal instance's selection accessors to force
  // hasSelection→true and getSelection→marker. handleSelectCopy reads
  // those exclusively, so this fully exercises the event path without
  // depending on shell output, render timing, or mouse-tracking state.
  await page.evaluate(
    ({ id, text }) => {
      const term = (
        window as unknown as {
          __webmuxTerminals?: Map<string, Record<string, unknown>>;
        }
      ).__webmuxTerminals?.get(id);
      if (!term) throw new Error("terminal not found in __webmuxTerminals");
      term.hasSelection = () => true;
      term.getSelection = () => text;
    },
    { id: terminalId, text: marker },
  );

  // Reproduce the bug scenario via real synthetic input (more reliable
  // across chromium builds than JS dispatchEvent): mouse down inside the
  // terminal container, then move and release in an empty area (top-left
  // 4x4 px viewport corner) which is OUTSIDE the terminal but still on
  // the document. Pre-fix, the container-scoped mouseup listener never
  // fired and clipboardWrite was never called.
  const containerBox = await page.evaluate(() => {
    const container = document.querySelector(
      "[data-testid^='terminal-card-'] .xterm",
    )?.parentElement;
    if (!container) throw new Error("terminal container not found");
    const rect = container.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(
    containerBox.x + containerBox.width / 2,
    containerBox.y + containerBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();

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

test("copy-on-select writes after xterm reports the completed selection", async ({
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

  const marker = `SELECTION-CHANGE-${Math.random().toString(36).slice(2, 8)}`;

  await page.evaluate(
    ({ id, text }) => {
      const term = (
        window as unknown as {
          __webmuxTerminals?: Map<
            string,
            {
              hasSelection: () => boolean;
              getSelection: () => string;
              select: (column: number, row: number, length: number) => void;
            }
          >;
        }
      ).__webmuxTerminals?.get(id);
      if (!term) throw new Error("terminal not found in __webmuxTerminals");
      term.hasSelection = () => true;
      term.getSelection = () => text;
      term.select(0, 0, 1);
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
                __webmuxClipboardWrites: string[];
              }
            ).__webmuxClipboardWrites.join("\n"),
        ),
      { timeout: 5_000 },
    )
    .toContain(marker);
});

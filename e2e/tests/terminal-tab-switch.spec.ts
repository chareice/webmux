import { test, expect } from "@playwright/test";

import {
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

// Regression test for the tab-switch staleness bug:
// https://…/docs/superpowers/specs/2026-04-17-terminal-resume-protocol-design.md
//
// Before the fix, React reused the TerminalCard (and its xterm) when the
// active tab changed, so the new terminal's replay was written on top of the
// previous terminal's xterm state. With TerminalCard keyed by terminal.id,
// switching tabs unmounts + remounts the card, giving each tab a fresh xterm
// populated from the hub's authoritative replay.
test("switching tabs does not bleed content from the previous terminal", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  // resetMachineState releases control as its final step; creating terminals
  // requires being the controller, so re-take it here.
  await requestMachineControl(page);

  const headers = await getAuthHeaders(page);
  const deviceId = await getDeviceId(page);
  const machineId = "e2e-node";

  const createTerminalWithMarker = async (marker: string) => {
    const response = await page.request.post(
      `/api/machines/${machineId}/terminals`,
      {
        headers,
        data: {
          cwd: "/tmp",
          device_id: deviceId,
          startup_command: `printf '%s\\n' '${marker}'`,
        },
      },
    );
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { id: string };
    return body.id;
  };

  const markerA = "TERM_A_UNIQUE_MARKER_ZZZ";
  const markerB = "TERM_B_UNIQUE_MARKER_YYY";

  const idA = await createTerminalWithMarker(markerA);
  const idB = await createTerminalWithMarker(markerB);

  // Wait until both terminals exist in server state
  await expect
    .poll(async () => (await listTerminals(page)).length)
    .toBe(2);

  // xterm with the WebGL renderer paints to canvas, so reading `.xterm-rows`
  // from the DOM returns nothing. TerminalView.xterm exposes live Terminal
  // instances on `window.__webmuxTerminals` (keyed by terminal id); we read
  // the authoritative active-buffer contents through that hook.
  const readTerminalBuffer = async (terminalId: string): Promise<string> => {
    await page.waitForTimeout(400);
    return page.evaluate((id) => {
      const map = (
        window as unknown as { __webmuxTerminals?: Map<string, unknown> }
      ).__webmuxTerminals;
      const term = map?.get(id) as
        | {
            buffer: {
              active: {
                length: number;
                getLine: (
                  i: number,
                ) => { translateToString: (trim: boolean) => string } | undefined;
              };
            };
          }
        | undefined;
      if (!term) return "";
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      return lines.join("\n");
    }, terminalId);
  };

  // Enter immersive mode for terminal A via the Overview card.
  // (The same testid also matches a hidden-mount copy; scope to visible.)
  await page.locator(`[data-testid='terminal-card-${idA}']:visible`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  const termAText = await readTerminalBuffer(idA);
  expect(termAText).toContain(markerA);
  expect(termAText).not.toContain(markerB);

  // Switch to terminal B via the breadcrumb sibling chip.
  await page.getByTestId(`breadcrumb-sibling-${idB}`).click();
  const termBText = await readTerminalBuffer(idB);
  expect(termBText).toContain(markerB);
  expect(termBText).not.toContain(markerA);

  // Switch back to A — the bug surfaced here most often: old B content stuck.
  await page.getByTestId(`breadcrumb-sibling-${idA}`).click();
  const termAText2 = await readTerminalBuffer(idA);
  expect(termAText2).toContain(markerA);
  expect(termAText2).not.toContain(markerB);

  await context.close();
});

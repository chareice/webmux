import { test, expect } from "@playwright/test";

import {
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
  listTerminals,
  openApp,
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

  const readVisibleText = async (): Promise<string> => {
    // xterm renders visible rows into .xterm-rows; scrollback is disabled so
    // this is the complete client-side content. Wait briefly for the new tab
    // to paint before sampling.
    await page.waitForTimeout(300);
    return (await getImmersiveTerminal(page)
      .locator(".xterm-rows")
      .first()
      .innerText()) ?? "";
  };

  await page.getByTestId(`tab-${idA}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();
  const termAText = await readVisibleText();
  expect(termAText).toContain(markerA);
  expect(termAText).not.toContain(markerB);

  await page.getByTestId(`tab-${idB}`).click();
  const termBText = await readVisibleText();
  expect(termBText).toContain(markerB);
  expect(termBText).not.toContain(markerA);

  // Switch back to A — the bug surfaced here most often: old B content stuck.
  await page.getByTestId(`tab-${idA}`).click();
  const termAText2 = await readVisibleText();
  expect(termAText2).toContain(markerA);
  expect(termAText2).not.toContain(markerB);

  await context.close();
});

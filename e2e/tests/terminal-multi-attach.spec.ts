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

// Two browser contexts attach to the same terminal. tmux's native multi-
// client behavior gives each browser an independent attach: each one gets
// its own initial repaint, and live shell echo propagates to both. The
// hub is now a transparent byte router; if this test passes the per-attach
// pipeline is wired correctly through machine → hub → both browsers.
test("two simultaneous attaches both render the same terminal content", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await openApp(pageA);
  await resetMachineState(pageA);
  await requestMachineControl(pageA);

  const headers = await getAuthHeaders(pageA);
  const deviceIdA = await getDeviceId(pageA);
  const machineId = "e2e-node";

  // Marker computed at runtime so the shell's command-echo doesn't trip
  // any waitFor matching the literal source command.
  const marker = `MULTI_ATTACH_${Date.now()}`;
  // Leading \r flushes the post-create Ctrl+L sitting in dash's line-edit
  // buffer; without it dash treats the leading form-feed as part of our
  // command and bails. (See pty.rs:559 in earlier code; the new pty.rs
  // does not emit Ctrl+L, but the e2e helpers may still be on a path that
  // does, so the \r is harmless either way.)
  const startup = `\rprintf '%s\\n' "${marker}"`;

  const resp = await pageA.request.post(`/api/machines/${machineId}/terminals`, {
    headers,
    data: { cwd: "/tmp", device_id: deviceIdA, startup_command: startup },
  });
  expect(resp.ok()).toBeTruthy();
  const tid = ((await resp.json()) as { id: string }).id;

  await expect.poll(async () => (await listTerminals(pageA)).length).toBe(1);

  // Open in A first (drives initial tmux attach + repaint via the WS).
  // Vertical-workpath UI: click the overview card to enter immersive mode.
  await pageA
    .locator(`[data-testid='terminal-card-${tid}']:visible`)
    .click();
  await expect(getImmersiveTerminal(pageA)).toBeVisible();

  // Open the SAME terminal in browser B — it gets its own independent
  // tmux attach on the machine, hence its own fresh repaint.
  await openApp(pageB);
  await pageB
    .locator(`[data-testid='terminal-card-${tid}']:visible`)
    .click();
  await expect(getImmersiveTerminal(pageB)).toBeVisible();

  const readBuffer =
    (page: import("@playwright/test").Page) =>
    async (id: string): Promise<string> =>
      page.evaluate((tid) => {
        const map = (
          window as unknown as { __webmuxTerminals?: Map<string, unknown> }
        ).__webmuxTerminals;
        const term = map?.get(tid) as
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
      }, id);

  // Both attaches should converge to a state that contains the marker.
  await expect.poll(() => readBuffer(pageA)(tid), { timeout: 15_000 }).toContain(marker);
  await expect.poll(() => readBuffer(pageB)(tid), { timeout: 15_000 }).toContain(marker);

  await ctxA.close();
  await ctxB.close();
});

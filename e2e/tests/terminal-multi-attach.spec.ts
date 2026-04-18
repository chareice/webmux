import { test, expect } from "@playwright/test";

import {
  expandTerminalById,
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

  // Marker computed at runtime so the shell's command-echo doesn't trip
  // any waitFor matching the literal source command.
  const marker = `MULTI_ATTACH_${Date.now()}`;
  const startup = `\rprintf '%s\\n' "${marker}"`;

  const resp = await pageA.request.post("/api/machines/e2e-node/terminals", {
    headers: {
      Authorization: `Bearer ${await pageA.evaluate(() => localStorage.getItem("webmux:token"))}`,
    },
    data: {
      cwd: "/tmp",
      device_id: await pageA.evaluate(() => sessionStorage.getItem("tc-device-id")),
      startup_command: startup,
    },
  });
  expect(resp.ok()).toBeTruthy();
  const tid = ((await resp.json()) as { id: string }).id;

  await expect.poll(async () => (await listTerminals(pageA)).length).toBe(1);

  await expandTerminalById(pageA, tid);

  // Open the same account on B and expand the same terminal — it gets its own
  // independent tmux attach on the machine and thus its own fresh repaint.
  await openApp(pageB);
  await expandTerminalById(pageB, tid);

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

  await expect.poll(() => readBuffer(pageA)(tid), { timeout: 15_000 }).toContain(marker);
  await expect.poll(() => readBuffer(pageB)(tid), { timeout: 15_000 }).toContain(marker);

  await ctxA.close();
  await ctxB.close();
});

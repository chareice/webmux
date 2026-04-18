import { test, expect } from "@playwright/test";

import {
  expandTerminalById,
  listTerminals,
  openApp,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

// Force a WS drop and reconnect. With per-attach tmux clients, each
// reconnect spawns a brand-new `tmux attach` whose initial repaint is
// overlaid on the preserved xterm. The marker must appear exactly once
// (no duplication from a stacked replay; no loss).
test("WS reconnect rebuilds the attach via a fresh tmux client", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

  // Marker assembled at runtime from two shell variables so the shell's
  // own command echo doesn't contain the literal string — only the printf
  // output does. Otherwise the marker would already appear twice (echo +
  // output) before any reconnect, defeating the count-stays-at-1 check.
  const ts = Date.now().toString();
  const marker = `RECOVERY_${ts}`;
  const startup = `\r_A=RECOVERY; _B=${ts}; printf '%s_%s\\n' "$_A" "$_B"`;

  const resp = await page.request.post("/api/machines/e2e-node/terminals", {
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("webmux:token"))}`,
    },
    data: {
      cwd: "/tmp",
      device_id: await page.evaluate(() => sessionStorage.getItem("tc-device-id")),
      startup_command: startup,
    },
  });
  expect(resp.ok()).toBeTruthy();
  const tid = ((await resp.json()) as { id: string }).id;

  await expect.poll(async () => (await listTerminals(page)).length).toBe(1);
  await expandTerminalById(page, tid);

  const readBuffer = async (): Promise<string> =>
    page.evaluate((id) => {
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
      for (let i = 0; i < buf.length; i++)
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      return lines.join("\n");
    }, tid);

  await expect.poll(readBuffer, { timeout: 15_000 }).toContain(marker);

  // Drop the WS and reconnect.
  await context.setOffline(true);
  await page.waitForTimeout(200);
  await context.setOffline(false);
  // Reconnect delay (1s) + handshake + new tmux attach repaint.
  await page.waitForTimeout(3000);

  const text = await readBuffer();
  const count = (text.match(new RegExp(marker, "g")) ?? []).length;
  expect(count).toBe(1);

  await context.close();
});

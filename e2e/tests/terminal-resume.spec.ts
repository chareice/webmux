import { test, expect } from "@playwright/test";

import {
  getAuthHeaders,
  getDeviceId,
  getImmersiveTerminal,
  listTerminals,
  openApp,
  resetMachineState,
} from "./helpers";

// Regression test for the WS-reconnect duplication bug:
// https://…/docs/superpowers/specs/2026-04-17-terminal-resume-protocol-design.md
//
// Before the resume protocol, the hub unconditionally sent a 64 KB replay on
// every new terminal WebSocket subscription. Because the browser deliberately
// keeps the xterm instance alive across WS reconnects (to preserve mouse
// tracking and alt-screen state), that replay was written on top of already-
// rendered content — users saw the same lines twice. The hub now tracks a
// per-terminal byte seq and honors `?after_seq=N`, returning only a delta
// (or a reset marker if the client is outside the retained window). The
// client tracks lastSeenSeq across the effect re-run and sends it on
// reconnect, so the same content never lands in xterm twice.
test("WS reconnect does not duplicate terminal content", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);

  const headers = await getAuthHeaders(page);
  const deviceId = await getDeviceId(page);
  const machineId = "e2e-node";

  // A unique, easily-counted sentinel. Ends with a digit boundary so a
  // partially-replayed fragment can't accidentally match.
  const marker = "UNIQUE_RESUME_MARKER_0001";

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
  const terminalId = ((await response.json()) as { id: string }).id;

  await expect
    .poll(async () => (await listTerminals(page)).length)
    .toBe(1);

  await page.getByTestId(`tab-${terminalId}`).click();
  await expect(getImmersiveTerminal(page)).toBeVisible();

  // Wait for the initial shell output to settle in xterm.
  await expect
    .poll(
      async () =>
        await getImmersiveTerminal(page)
          .locator(".xterm-rows")
          .first()
          .innerText(),
    )
    .toContain(marker);

  const countMarker = async (): Promise<number> => {
    const text =
      (await getImmersiveTerminal(page)
        .locator(".xterm-rows")
        .first()
        .innerText()) ?? "";
    const pattern = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (text.match(new RegExp(pattern, "g")) ?? []).length;
  };

  expect(await countMarker()).toBe(1);

  // Force the terminal WebSocket to drop and reconnect. `setOffline(true)`
  // causes the browser to close open WebSockets; onclose schedules a 1s
  // reconnect. Re-enabling the network before the timer fires lets the new
  // WS handshake succeed.
  await context.setOffline(true);
  await page.waitForTimeout(200);
  await context.setOffline(false);
  // 1s reconnect delay + handshake + attach frame + any replay delta.
  await page.waitForTimeout(3000);

  // After the resume handshake the marker should still appear exactly once.
  // Without the fix, the hub's full-buffer replay stacked on top of the
  // preserved xterm and the count would be 2 (or more on repeated reconnects).
  expect(await countMarker()).toBe(1);

  await context.close();
});

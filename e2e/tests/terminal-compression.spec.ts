import { test, expect } from "@playwright/test";

import {
  createTerminalViaApi,
  expandTerminalById,
  openApp,
  readTerminalBuffer,
  requestMachineControl,
  resetMachineState,
} from "./helpers";

// deflate-raw-v1 is ON by default in the e2e environment (hub, machine, and
// web all support it, and the localStorage "webmux:compress" escape hatch is
// unset), so the entire suite exercises the compressed path; this spec pins
// the negotiation and stream integrity explicitly.
test("terminal output streams through deflate-raw-v1 when negotiated", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);

  const tid = await createTerminalViaApi(page, {
    cwd: "/tmp",
    startupCommand: "seq 1 2000",
  });
  await expandTerminalById(page, tid);

  // The hub sends the CompressionEnabled ack before any output byte can
  // reach the socket; the app exposes it as window.__webmuxCompression.
  await page.waitForFunction(
    (id) =>
      (window as unknown as { __webmuxCompression?: Record<string, boolean> })
        .__webmuxCompression?.[id] === true,
    tid,
    { timeout: 15_000 },
  );

  // 2000 lines of burst output through the inflated stream: the tail must
  // arrive intact and in order.
  await expect
    .poll(async () => readTerminalBuffer(page, tid), { timeout: 15_000 })
    .toMatch(/1998\n1999\n2000/);
});

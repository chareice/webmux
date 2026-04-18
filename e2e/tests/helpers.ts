import { expect, type Locator, type Page } from "@playwright/test";

const MACHINE_ID = "e2e-node";
// The workbench grid puts `grid-card-<id>` on each card. The mobile shell's
// Terminals tab puts `mobile-term-card-<id>` instead. Both are "one card per
// terminal" so tests can treat them as interchangeable for counting and
// clicking.
const TERMINAL_CARD_SELECTOR =
  "[data-testid^='grid-card-'], [data-testid^='mobile-term-card-']";

async function authenticate(page: Page): Promise<void> {
  const response = await page.request.get("/api/auth/dev");
  expect(response.ok()).toBeTruthy();

  const { token } = await response.json();
  await page.context().addInitScript((value) => {
    localStorage.setItem("webmux:token", value);
    // Opt-in to test-only hooks (e.g. the window.__webmuxTerminals map that
    // exposes live xterm instances for buffer inspection). Production builds
    // never set this flag and therefore never expose internals globally.
    localStorage.setItem("webmux:e2e", "1");
  }, token);
}

/**
 * Open the app, authenticate, and wait for the new workbench shell to be
 * ready. Works for both desktop (Rail + WorkbenchHeader) and mobile
 * (MobileWorkbench) layouts.
 */
export async function openApp(page: Page): Promise<void> {
  await authenticate(page);
  await page.goto("/");
  await Promise.race([
    page.getByTestId("workbench-header").waitFor({
      state: "visible",
      timeout: 20_000,
    }),
    page.getByTestId("mobile-workbench").waitFor({
      state: "visible",
      timeout: 20_000,
    }),
  ]);
}

export async function getAuthHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("webmux:token"));
  expect(token).toBeTruthy();
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function getDeviceId(page: Page): Promise<string> {
  await page.waitForFunction(() => !!sessionStorage.getItem("tc-device-id"));
  const deviceId = await page.evaluate(() => sessionStorage.getItem("tc-device-id"));
  expect(deviceId).toBeTruthy();
  return deviceId!;
}

export async function listTerminals(page: Page): Promise<Array<{
  id: string;
  machine_id: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
}>> {
  const response = await page.request.get("/api/terminals", {
    headers: await getAuthHeaders(page),
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function requestMachineControl(page: Page): Promise<void> {
  const response = await page.request.post("/api/mode/control", {
    headers: await getAuthHeaders(page),
    data: {
      machine_id: MACHINE_ID,
      device_id: await getDeviceId(page),
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function releaseMachineControl(page: Page): Promise<void> {
  const response = await page.request.post("/api/mode/release", {
    headers: await getAuthHeaders(page),
    data: {
      machine_id: MACHINE_ID,
      device_id: await getDeviceId(page),
    },
  });
  // Server may respond with a 2xx regardless of whether a lease existed.
  expect(response.ok()).toBeTruthy();
}

export async function destroyAllTerminals(page: Page): Promise<void> {
  const headers = await getAuthHeaders(page);
  const deviceId = await getDeviceId(page);
  for (const terminal of await listTerminals(page)) {
    const response = await page.request.delete(
      `/api/machines/${terminal.machine_id}/terminals/${terminal.id}?device_id=${encodeURIComponent(deviceId)}`,
      { headers },
    );
    expect(response.ok()).toBeTruthy();
  }
}

export async function resetMachineState(page: Page): Promise<void> {
  await requestMachineControl(page);
  await destroyAllTerminals(page);
  await expectTerminalCount(page, 0);
  // Release control via API (works on both desktop and mobile — mobile has no
  // header toggle). Then wait for the UI to pick up the mode change so
  // follow-up assertions on the Control Here / Request control button land
  // reliably.
  await releaseMachineControl(page);
  const header = page.getByTestId("workbench-header");
  if (await header.isVisible().catch(() => false)) {
    await expect(page.getByTestId("workbench-request-control")).toBeVisible();
  }
}

/**
 * Return the header control toggle — either "workbench-request-control" (when
 * viewing) or "workbench-stop-control" (when controlling). Only one is in the
 * DOM at a time, and `.or()` short-circuits to the visible one.
 */
export function getControlToggle(page: Page): Locator {
  return page
    .getByTestId("workbench-request-control")
    .or(page.getByTestId("workbench-stop-control"));
}

export async function expectControlState(
  page: Page,
  state: "controlling" | "viewing",
): Promise<void> {
  if (state === "controlling") {
    await expect(page.getByTestId("workbench-stop-control")).toBeVisible();
  } else {
    await expect(page.getByTestId("workbench-request-control")).toBeVisible();
  }
}

export async function takeControlFromHeader(page: Page): Promise<void> {
  await page.getByTestId("workbench-request-control").click();
  await expectControlState(page, "controlling");
}

export async function releaseControlFromHeader(page: Page): Promise<void> {
  await page.getByTestId("workbench-stop-control").click();
  await expectControlState(page, "viewing");
}

export async function selectAllWorkpath(page: Page): Promise<void> {
  await page.getByTestId("rail-workpath-all").click();
}

export async function selectHomeWorkpath(page: Page): Promise<void> {
  // The fallback bookmark id for every machine is "local-home".
  await page.getByTestId("rail-workpath-local-home").click();
}

/**
 * Create a terminal for the current machine in its home directory and return
 * the terminal id. Uses the REST API directly — faster and more deterministic
 * than the UI "New terminal" button, which auto-opens the expanded overlay.
 */
export async function createTerminalViaApi(
  page: Page,
  opts: { cwd?: string; startupCommand?: string } = {},
): Promise<string> {
  const headers = await getAuthHeaders(page);
  const deviceId = await getDeviceId(page);
  const cwd = opts.cwd ?? "/root";
  const resp = await page.request.post(`/api/machines/${MACHINE_ID}/terminals`, {
    headers,
    data: {
      cwd,
      device_id: deviceId,
      ...(opts.startupCommand ? { startup_command: opts.startupCommand } : {}),
    },
  });
  expect(resp.ok()).toBeTruthy();
  return ((await resp.json()) as { id: string }).id;
}

export async function expectSingleTerminalCard(page: Page): Promise<Locator> {
  const cards = getTerminalCards(page);
  await expect(cards).toHaveCount(1);
  return cards.first();
}

export function getTerminalCards(page: Page): Locator {
  return page.locator(`${TERMINAL_CARD_SELECTOR}`).and(page.locator(":visible"));
}

export async function expectTerminalCount(
  page: Page,
  count: number,
): Promise<void> {
  await expect(getTerminalCards(page)).toHaveCount(count);
}

export function getExpandedOverlay(page: Page): Locator {
  return page.getByTestId("expanded-terminal");
}

export function getImmersiveTerminal(page: Page): Locator {
  // The TerminalCard in `tab` display mode (used inside the ExpandedTerminal
  // overlay) carries a `data-terminal-display-mode="immersive"` marker via
  // TerminalView.web.
  return page.locator("[data-terminal-display-mode='immersive']").first();
}

/**
 * Open the expanded overlay for the only (or first) terminal in the current
 * grid. If the overlay is already open, just return its immersive locator.
 */
export async function expandOnlyTerminal(page: Page): Promise<Locator> {
  const immersive = getImmersiveTerminal(page);
  if (await immersive.isVisible().catch(() => false)) {
    return immersive;
  }
  const card = await expectSingleTerminalCard(page);
  await card.click();
  await expect(getExpandedOverlay(page)).toBeVisible();
  await expect(immersive).toBeVisible();
  return immersive;
}

export async function expandTerminalById(
  page: Page,
  terminalId: string,
): Promise<Locator> {
  await page.locator(`[data-testid='grid-card-${terminalId}']:visible`).click();
  await expect(getExpandedOverlay(page)).toBeVisible();
  return getImmersiveTerminal(page);
}

export async function closeExpandedOverlay(page: Page): Promise<void> {
  await page.getByTestId("expanded-close").click();
  await expect(getExpandedOverlay(page)).toHaveCount(0);
}

export async function getTerminalViewScale(page: Page): Promise<number> {
  const scale = await getImmersiveTerminal(page).getAttribute(
    "data-terminal-view-scale",
  );
  return Number(scale);
}

export async function getTerminalViewJustify(
  page: Page,
): Promise<string | null> {
  return getImmersiveTerminal(page).getAttribute("data-terminal-view-justify");
}

/**
 * Mobile-specific: tap the "Stats" bottom tab and click Request/Stop control
 * from the Actions panel.
 */
export async function mobileTakeControl(page: Page): Promise<void> {
  await page.getByText("Stats", { exact: true }).click();
  await page
    .getByRole("button", { name: /Request control/i })
    .click();
}

export async function mobileReleaseControl(page: Page): Promise<void> {
  await page.getByText("Stats", { exact: true }).click();
  await page
    .getByRole("button", { name: /Release control/i })
    .click();
}

export async function mobileSwitchTab(
  page: Page,
  label: "Hosts" | "Terminals" | "Stats",
): Promise<void> {
  await page.getByText(label, { exact: true }).click();
}

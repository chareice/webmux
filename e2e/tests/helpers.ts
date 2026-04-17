import { expect, type Locator, type Page } from "@playwright/test";

const MACHINE_ID = "e2e-node";
const TERMINAL_CARD_SELECTOR = "[data-testid^='terminal-card-']";

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

export async function openApp(page: Page): Promise<void> {
  await authenticate(page);
  await page.goto("/");
  await Promise.race([
    page.getByTestId("workpath-rail").waitFor({
      state: "visible",
      timeout: 20_000,
    }),
    page.getByTestId("canvas-mode-toggle").waitFor({
      state: "visible",
      timeout: 20_000,
    }),
    page.getByTestId("statusbar-mode-toggle").waitFor({
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
  const toggle = getGlobalModeToggle(page);
  const label = (await toggle.textContent())?.trim();
  if (label === "Stop Control") {
    await toggle.click();
  }
  await expectGlobalModeToggleLabel(page, "Control Here");
}

/**
 * Expand the nav column by hovering the rail so the overlay becomes visible.
 * The overlay is also force-expanded by `Cmd/Ctrl+B`, but hover is the
 * stable path for tests (no keyboard focus races).
 */
export async function expandNavColumn(page: Page): Promise<void> {
  const overlay = page.getByTestId("workpath-overlay");
  if (await overlay.isVisible().catch(() => false)) {
    return;
  }
  const rail = page.getByTestId("workpath-rail");
  await rail.hover();
  await expect(overlay).toBeVisible();
}

// Backwards-compatible alias. The old helper was named after the sidebar's
// per-machine section; the new nav column uses a single overlay.
export async function expandMachineSection(page: Page): Promise<void> {
  await expandNavColumn(page);
}

export async function expectSingleTerminalCard(page: Page): Promise<Locator> {
  const cards = getTerminalCards(page);
  await expect(cards).toHaveCount(1);
  return cards.first();
}

export function getTerminalCards(page: Page): Locator {
  return page.locator(`${TERMINAL_CARD_SELECTOR}:visible`);
}

export async function expectTerminalCount(
  page: Page,
  count: number,
): Promise<void> {
  await expect(getTerminalCards(page)).toHaveCount(count);
}

export async function openRootBookmark(page: Page): Promise<void> {
  const sidebarToggle = page.getByTestId("mobile-sidebar-toggle");
  if (
    await sidebarToggle
      .isVisible()
      .catch(() => false)
  ) {
    await sidebarToggle.click();
  }

  await expandNavColumn(page);
  await page.getByTestId("overlay-bookmark-local-home").click();
}

export function getGlobalModeToggle(page: Page): Locator {
  const statusToggle = page.getByTestId("statusbar-mode-toggle");
  const canvasToggle = page.getByTestId("canvas-mode-toggle");
  return statusToggle.or(canvasToggle).first();
}

export async function expectGlobalModeToggleLabel(
  page: Page,
  label: string,
): Promise<void> {
  await expect(getGlobalModeToggle(page)).toHaveText(label);
}

export async function maximizeOnlyTerminal(page: Page): Promise<Locator> {
  // After creating a terminal, it auto-zooms (immersive mode).
  // If already zoomed, just wait for the terminal card.
  // If in overview grid (e.g. navigated back), click the card.
  const immersive = getImmersiveTerminal(page);
  if (await immersive.isVisible().catch(() => false)) {
    const card = page.locator(TERMINAL_CARD_SELECTOR).first();
    await expect(card).toBeVisible();
    return card;
  }

  // Click the first terminal card to zoom in
  const card = await expectSingleTerminalCard(page);
  await card.click();
  await expect(immersive).toBeVisible();
  return page.locator(TERMINAL_CARD_SELECTOR).first();
}

export function getImmersiveTerminal(page: Page): Locator {
  return page.locator("[data-terminal-display-mode='immersive']").first();
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

import { expect, type Locator, type Page } from "@playwright/test";

const MACHINE_SECTION_TEST_ID = "machine-section-e2e-node";

async function authenticate(page: Page): Promise<void> {
  const response = await page.request.get("/api/auth/dev");
  expect(response.ok()).toBeTruthy();

  const { token } = await response.json();
  await page.context().addInitScript((value) => {
    localStorage.setItem("webmux:token", value);
  }, token);
}

export async function openApp(page: Page): Promise<void> {
  await authenticate(page);
  await page.goto("/");
  await Promise.race([
    page.getByTestId(MACHINE_SECTION_TEST_ID).waitFor({
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

export async function expandMachineSection(page: Page): Promise<void> {
  const bookmark = page.getByTestId("machine-bookmark-local-home");
  if (await bookmark.count()) {
    return;
  }

  await page.getByTestId(MACHINE_SECTION_TEST_ID).click();
  await expect(bookmark).toBeVisible();
}

export async function expectSingleTerminalCard(page: Page): Promise<Locator> {
  const cards = page.locator("[data-testid^='terminal-card-']");
  await expect(cards).toHaveCount(1);
  return cards.first();
}

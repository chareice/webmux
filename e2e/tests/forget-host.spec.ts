import { test, expect } from "@playwright/test";
import { getAuthHeaders, openApp, resetMachineState } from "./helpers";

test("desktop host switcher can forget a registered host", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  await openApp(page);
  await resetMachineState(page);

  const headers = await getAuthHeaders(page);
  const tokenResponse = await page.request.post("/api/machines/register-token", {
    headers,
    data: { name: "stale" },
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const { token } = (await tokenResponse.json()) as { token: string };

  const registerResponse = await page.request.post("/api/machines/register", {
    data: { token, name: "stale-box" },
  });
  expect(registerResponse.ok()).toBeTruthy();
  const { machine_id: machineId } = (await registerResponse.json()) as {
    machine_id: string;
  };

  await page.reload();
  await expect(page.getByTestId("tab-bar")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("host-switcher-button").click();
  const host = page.getByTestId(`host-switcher-row-${machineId}`);
  await expect(host).toBeVisible();

  await page.getByTestId(`host-switcher-remove-${machineId}`).click();

  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("stale-box");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("host-switcher-button").click();
  await expect(host).toBeVisible();

  await page.getByTestId(`host-switcher-remove-${machineId}`).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Remove host" }).click();
  await expect(host).toHaveCount(0);

  const machinesResponse = await page.request.get(
    "/api/machines?include_offline=true",
    { headers },
  );
  expect(machinesResponse.ok()).toBeTruthy();
  const machines = (await machinesResponse.json()) as Array<{ id: string }>;
  expect(machines.some((machine) => machine.id === machineId)).toBeFalsy();

  await context.close();
});

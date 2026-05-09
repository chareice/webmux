import { expect, test } from "@playwright/test";

import { getAuthHeaders, openApp } from "./helpers";

test("native zellij entry and API are removed", async ({ page }) => {
  await openApp(page);

  await expect(page.getByTestId("rail-native-zellij")).toHaveCount(0);
  await expect(page.getByText("Native Zellij")).toHaveCount(0);

  const response = await page.request.get(
    "/api/machines/e2e-node/native-zellij",
    {
      headers: await getAuthHeaders(page),
    },
  );
  expect(response.status()).toBe(404);

  const apiRootResponse = await page.request.get("/api", {
    headers: await getAuthHeaders(page),
  });
  expect(apiRootResponse.status()).toBe(404);
});

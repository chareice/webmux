import { expect, test } from "@playwright/test";

import { getAuthHeaders, openApp } from "./helpers";

test("native zellij sidebar entry opens the managed browser session", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const webSocketUrls: string[] = [];
  page.on("websocket", (socket) => {
    webSocketUrls.push(socket.url());
  });

  await openApp(page);

  const bootstrapResponse = await page.request.get(
    "/api/machines/e2e-node/native-zellij",
    {
      headers: await getAuthHeaders(page),
    },
  );
  expect(bootstrapResponse.ok()).toBeTruthy();
  const bootstrap = (await bootstrapResponse.json()) as {
    status:
      | {
          status: "ready";
          session_name: string;
          session_path: string;
          base_url: string;
          login_token: string;
        }
      | {
          status: "unavailable";
          reason: string;
          instructions: string;
        };
    proxy_url: string | null;
  };
  expect(bootstrap.status.status).toBe("ready");
  expect(bootstrap.proxy_url).toBeTruthy();

  await page.getByTestId("rail-native-zellij").click();
  await expect(page).toHaveURL(/\/machines\/e2e-node\/native-zellij$/);
  await expect(page.getByTestId("native-zellij-frame")).toBeVisible();

  await expect
    .poll(
      () =>
        webSocketUrls.filter((url) =>
          url.includes("/api/machines/e2e-node/native-zellij/proxy/ws/terminal/"),
        ).length,
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await expect
    .poll(
      () =>
        webSocketUrls.filter((url) =>
          url.includes("/api/machines/e2e-node/native-zellij/proxy/ws/control"),
        ).length,
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  const frameHandle = await page
    .locator("[data-testid='native-zellij-frame']")
    .elementHandle();
  expect(frameHandle).toBeTruthy();
  const frame = await frameHandle!.contentFrame();
  expect(frame).toBeTruthy();

  await expect
    .poll(
      async () => frame!.evaluate(() => document.title),
      { timeout: 60_000 },
    )
    .toBe(bootstrap.status.status === "ready" ? bootstrap.status.session_name : "");
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4317",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/artifacts/playwright-report" }],
  ],
  outputDir: "e2e/artifacts/test-results",
});

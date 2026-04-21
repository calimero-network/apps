import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for UI-only tests with mocked backend.
 * No live Calimero node required.
 *
 * Run with:  pnpm test:mocked
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/ui.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  // No globalSetup — these tests inject their own auth via page.addInitScript
  use: {
    baseURL: "http://localhost:5173",
    storageState: { cookies: [], origins: [] },
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});

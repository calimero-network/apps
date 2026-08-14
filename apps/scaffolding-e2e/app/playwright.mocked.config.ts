import { defineConfig, devices } from "@playwright/test";

// Dev-server port — overridable so a local run cannot collide with another Vite
// server already on 5173. That collision is not theoretical: with
// `reuseExistingServer: true` and, say, admin-dashboard already running, Playwright
// silently drives THAT app and every test fails on a missing selector. In CI the
// port is free and a stale server can never be reused.
const PORT = process.env.PW_PORT ?? "5173";


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
    baseURL: `http://localhost:${PORT}`,
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
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});

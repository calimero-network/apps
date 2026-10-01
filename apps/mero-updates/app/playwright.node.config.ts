import { defineConfig } from "@playwright/test";

// The NODE-backed suite (e2e/): a real merod, the real bundle, the founder's
// whole flow through the UI. Serial — every spec shares one node's state.
// The node-less shell suite is playwright.config.ts (tests/).
const PORT = process.env.PW_PORT ?? "5190";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["html", { outputFolder: "playwright-report" }], ["list"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    // A preinstalled Chromium, when the host has one and not the version this
    // Playwright pins (sandboxes, some dev machines). CI installs its own.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

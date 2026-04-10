import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,        // 2 min per test — RPC calls can be slow
  expect: { timeout: 10_000 },
  fullyParallel: false,    // tests share a live node — run serially
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  globalSetup: "./tests/global-setup.ts",

  use: {
    baseURL: "http://localhost:5173",
    // Reuse the saved auth session (created by global-setup or `pnpm run test:auth`)
    storageState: "tests/.auth/state.json",
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

  // Expect the dev server to already be running (`pnpm dev` in another terminal).
  // If you want Playwright to start it automatically, uncomment:
  // webServer: {
  //   command: "pnpm dev",
  //   url: "http://localhost:5173",
  //   reuseExistingServer: true,
  // },
});

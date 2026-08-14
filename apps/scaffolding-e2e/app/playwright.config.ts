import { defineConfig, devices } from "@playwright/test";

// Dev-server port — overridable so a local run cannot collide with another Vite
// server already on 5173. That collision is not theoretical: with
// `reuseExistingServer: true` and, say, admin-dashboard already running, Playwright
// silently drives THAT app and every test fails on a missing selector. In CI the
// port is free and a stale server can never be reused.
const PORT = process.env.PW_PORT ?? "5173";


export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,        // 2 min per test — RPC calls can be slow
  expect: { timeout: 10_000 },
  fullyParallel: false,    // tests share a live node — run serially
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  globalSetup: "./tests/global-setup.ts",

  use: {
    baseURL: `http://localhost:${PORT}`,
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

  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});

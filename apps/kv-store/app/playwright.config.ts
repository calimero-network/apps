import { defineConfig } from "@playwright/test";

// One local release-v2 cluster (`merod-v2 local`), started by global-setup;
// the app is served on http://localhost:5173, an origin the cluster allows.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env["CI"] ? "list" : "line",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    actionTimeout: 15_000,
    // A preinstalled Chromium from another Playwright release, when given.
    ...(process.env["PW_CHROMIUM_PATH"]
      ? { launchOptions: { executablePath: process.env["PW_CHROMIUM_PATH"] } }
      : {}),
  },
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      VITE_CALIMERO_URL: "http://127.0.0.1:2601",
      VITE_CALIMERO_ALLOW_MOCK: "true",
    },
  },
});

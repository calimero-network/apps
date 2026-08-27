import { defineConfig } from "@playwright/test";

// Serial on one node. Every spec drives the same context's UnorderedMap, and
// `clear` / `len` / the entries table are global to it — parallel workers would
// race over shared contract state and fail for reasons that have nothing to do
// with the code under test.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // A contract call round-trips through a real node; one lost race should not
  // fail the gate. A genuinely broken test still fails all attempts.
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "list" : "line",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Surface a wrong/missing testid in seconds rather than letting it eat the
    // whole test timeout.
    actionTimeout: 10_000,
  },
  webServer: {
    command: "npx vite --port 5173 --strictPort",
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

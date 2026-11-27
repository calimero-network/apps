// Sylence' page end to end on `merod local` (core's development cluster: three
// nodes on 127.0.0.1:2501-2503, mock attestation, passkey ceremonies trusted
// from http://localhost:5173).
//
// The web server is `pnpm dev:local mero-sylence`: it starts the cluster (or
// uses one already on :2501), builds and uploads this app's component, writes
// `.env.development.local` with that bundle and serves the page with Vite on
// :5173. Playwright starts web servers before the global setup, and the page
// needs the bundle when Vite starts, so it all happens there. CI runs it in
// components.yml's `browser` job (an app with app/playwright.config.ts). By hand:
//
//   MEROD_BIN=/path/to/merod pnpm -F mero-sylence test:e2e
//
// The browser signs up with Chromium's virtual authenticator; the suite then
// writes meetings through the contract with that session (e2e/sylence.ts).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // One account, one workspace: the steps build on each other.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173/",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node packages/merod-local/src/cli.ts dev mero-sylence${process.env.CI ? " --fresh" : ""}`,
    cwd: "../../..",
    url: "http://localhost:5173/",
    reuseExistingServer: !process.env.CI,
    // A cold component build on CI.
    timeout: 900_000,
    stdout: "pipe",
  },
});

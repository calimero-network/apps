// Calimero Home's browser e2e on `merod local` (core's development cluster:
// three nodes on 127.0.0.1:2501-2503, mock attestation, passkey ceremonies
// trusted from http://localhost:5173).
//
// ⚠️ NOT RUN IN CI YET. Home's screens need core's app-team routes (core#4890,
// #4891), which no core release has yet: 1.0.0-rc.13 does not. The suite is
// written against them and checks for them first (e2e/global-setup.ts throws a
// clear "needs a core release with app teams" on an older merod). Once the
// release lands: move `component-core-tag` to it, and add this app to the
// journey matrix (a `playwright.journey.config.ts`, or a components.yml leg).
// Until then, run it by hand against a merod built from core's master:
//
//   MEROD_BIN=/path/to/merod pnpm -F mero-home test:e2e
//
// The setup starts `merod local --fresh` (or uses one already on :2501),
// builds a dev-signed KV Store package to install into the org it seeds, and
// the browser signs up with Chromium's virtual authenticator.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One cluster, one org: the steps build on each other.
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
    command: "pnpm exec vite --port 5173 --strictPort",
    url: "http://localhost:5173/",
    reuseExistingServer: true,
    env: { VITE_CALIMERO_TARGET: "local" },
  },
});

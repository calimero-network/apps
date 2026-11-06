import { defineConfig, devices } from "@playwright/test";

/**
 * The cloud smoke: real served apps on a real TDX cluster, nothing local. One
 * test per package (`SMOKE_PACKAGES`), never retried — a retry would make a
 * second account and hide a flaky sign-in.
 */
export default defineConfig({
  testDir: "./src",
  testMatch: "**/*.smoke.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // The virtual authenticator is a CDP domain: Chromium only.
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
});

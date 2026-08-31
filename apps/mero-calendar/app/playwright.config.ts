import { defineConfig, devices } from "@playwright/test";

// Dev-server port — overridable so local runs avoid clashing with another app
// already on the default. Mero Calendar defaults to 5174.
const PORT = process.env.PW_PORT ?? "5174";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { outputFolder: "e2e-report" }]] : "list",

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      // No real node — all HTTP routes are mocked in-test.
      name: "mocked",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/*.spec.ts",
      testIgnore: "**/integration/**",
    },
    {
      // Drives a real merobox-bootstrapped node over JSON-RPC; self-skips if
      // none is reachable.
      name: "integration",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/integration/**/*.spec.ts",
    },
  ],

  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

// Dev server port — overridable so local runs can avoid a port clash with
// another app already sitting on the default. MeroPixArt defaults to 5176.
const PORT = process.env.PW_PORT ?? "5176";

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
      name: "mocked",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/*.spec.ts",
      testIgnore: "**/integration/**",
    },
    {
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

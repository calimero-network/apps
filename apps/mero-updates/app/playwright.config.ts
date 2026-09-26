import { defineConfig, devices } from "@playwright/test";

// 5190 — next free across the monorepo (5173 ×2, 5174–5176, 5186–5189 taken).
// --strictPort so a collision fails loudly instead of silently testing another app.
const PORT = process.env.PW_PORT ?? "5190";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { outputFolder: "playwright-report" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // A preinstalled Chromium when the host's does not match this Playwright's
    // pin (sandboxes, some dev machines). CI installs its own and leaves it unset.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

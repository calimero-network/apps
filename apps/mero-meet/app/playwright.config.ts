import { defineConfig, devices } from "@playwright/test";

// Port is overridable so a local run does not clash with another app's dev
// server, and --strictPort is deliberate: a 5173 collision elsewhere in the
// fleet once made a health check pass against a DIFFERENT app entirely, so
// failing loudly beats silently testing the wrong thing. 5185 is the next free
// one across the monorepo's configs.
const PORT = process.env.PW_PORT ?? "5185";

export default defineConfig({
  // `tests/`, not `scripts/`. scripts/call-e2e.mjs is a bespoke two-browser
  // driver run as `node scripts/call-e2e.mjs`; it is not a @playwright/test
  // spec and must not be collected as one.
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
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

// Port is overridable so a local run does not clash with another app's dev
// server. A 5173 collision once made a health check pass against a DIFFERENT
// app entirely, so --strictPort is deliberate: fail loudly rather than silently
// test the wrong thing.
const PORT = process.env.PW_PORT ?? "5175";

export default defineConfig({
  // `tests/`, not `e2e/`. e2e/ holds the bespoke `node e2e/*.mjs` drivers that
  // use the RAW `playwright` package (browser-call, capacity-ladder, ...); they
  // are not @playwright/test specs and must not be collected as such.
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

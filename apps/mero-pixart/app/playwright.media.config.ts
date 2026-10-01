import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Records the landing page's showcase clip (`pnpm landing:media`). The real
 * editor against the mocked node from e2e/support/mocks.ts — no merod, no
 * Docker — one recording at a time, because the clip holds its chapters to fixed
 * lengths and a second worker slows it past them.
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/media",
  retries: 0,
  timeout: 180_000,
  workers: 1,
  projects: [{ name: "media", use: { ...devices["Desktop Chrome"] } }],
});

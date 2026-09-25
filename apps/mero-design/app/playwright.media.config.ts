import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * Records the landing page's clips into public/landing (`pnpm landing:media`).
 *
 * Its own config, not a project in playwright.config.ts: CI runs a bare
 * `npx playwright test`, which runs every project there — and these assert
 * nothing and need ffmpeg. One at a time, because each clip holds its chapters
 * to a fixed length and two recordings sharing a machine slow each other past it.
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/media",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [{ name: "media", use: { ...devices["Desktop Chrome"] } }],
});

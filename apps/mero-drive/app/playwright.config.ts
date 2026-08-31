import { defineConfig, devices } from '@playwright/test';

const APP_URL = process.env.VITE_APP_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'pnpm dev --host 127.0.0.1 --port 5173',
        url: APP_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // Forward the collaboration feature flag to the dev server's
        // environment so Vite actually exposes `import.meta.env.VITE_COLLAB_YJS`
        // to the served app. Without this the flag set on the Playwright runner
        // never reaches the built app, so `COLLAB_YJS_ENABLED` stays false and
        // the collab editor never mounts — the two-node merge test would then
        // silently exercise the LWW shell. CI sets `VITE_COLLAB_YJS=true` only
        // on the two-node job (see integration-ci.yml); single-node/fast runs
        // leave it unset so they keep testing the default LWW path.
        env: {
          ...(process.env.VITE_COLLAB_YJS
            ? { VITE_COLLAB_YJS: process.env.VITE_COLLAB_YJS }
            : {}),
        },
      },
  projects: [
    {
      name: 'landing',
      testMatch: ['**/landing/**/*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: 'single-node',
      testMatch: ['**/single-node/**/*.spec.ts'],
      timeout: 180_000,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'two-node',
      testMatch: ['**/two-node/**/*.spec.ts'],
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
        trace: 'retain-on-failure',
      },
    },
  ],
});

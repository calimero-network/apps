import { defineConfig, devices } from '@playwright/test';

// mero-docs's own dev port - NOT vite's 5173 default, which two other apps in
// this monorepo already pin. See the note in vite.config.js.
const APP_PORT = process.env.PW_PORT ?? '5179';
const APP_URL = process.env.VITE_APP_URL ?? `http://localhost:${APP_PORT}`;

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
        command: `pnpm dev --host 127.0.0.1 --port ${APP_PORT}`,
        url: `http://localhost:${APP_PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
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
    {
      // The CRDT document editor over the three-node rig. Each window picks its
      // own node with `?node=`, so they share the one dev server.
      name: 'rich',
      testMatch: ['**/rich/**/*.spec.ts'],
      timeout: 900_000,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
        trace: 'retain-on-failure',
      },
    },
  ],
});

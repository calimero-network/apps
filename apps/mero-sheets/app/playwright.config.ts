import { defineConfig } from '@playwright/test';

/** This app's own dev port. Kept equal to the one pinned in vite.config.ts. */
const PORT = Number(process.env.PW_PORT) || 5185;

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT}`,
    port: PORT,
    // `reuseExistingServer` on a SHARED port is how a suite ends up testing a
    // different app: a stale dev server from another mero app answers, the
    // pages load, the screenshots are sharp, and none of it is this app. The
    // port below is this app's alone (see vite.config.ts), so reuse is safe.
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

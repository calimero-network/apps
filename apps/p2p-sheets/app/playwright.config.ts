import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Per-test budget. Kept generous for multi-node CRDT-sync stories (spawn
  // 3 contexts + wait for cross-node propagation), but far below the old
  // 240s: a genuinely broken test should not grind for 4 minutes.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Fail fast on a missing/wrong selector: a locator action (fill/click)
    // auto-waits at most this long instead of consuming the whole test
    // timeout — so a testid mismatch surfaces in ~15s, not minutes.
    actionTimeout: 15_000,
  },
  webServer: {
    command: 'npx vite --port 5173',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

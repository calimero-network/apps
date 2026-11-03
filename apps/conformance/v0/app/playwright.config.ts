import { defineConfig } from '@playwright/test';

// One worker, one spec, in order: both runs share the rig's nodes, and the
// second session's rows depend on what the primary just made.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // A run is ~60 rows, each a round trip through a real node, several waiting
  // for sync between two nodes.
  timeout: 15 * 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --port 5190 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5190/',
    // Never someone else's server on this port: the rig's page or nothing.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

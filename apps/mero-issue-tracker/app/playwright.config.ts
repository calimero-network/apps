import { defineConfig } from '@playwright/test';

// Per-spec-file workspace isolation (helpers.ts) gives each file its own
// namespace + context, so specs no longer share one board, which is what
// makes parallel workers safe. Default 2 workers when isolation is on, 1 when
// opted out (PW_ISOLATION=0). PW_WORKERS overrides either way.
const ISOLATION = process.env.PW_ISOLATION !== '0';
const WORKERS = Number(process.env.PW_WORKERS) || (ISOLATION ? 2 : 1);

export default defineConfig({
  testDir: './e2e',
  // Per-test budget. Kept generous for multi-node CRDT-sync stories (spawn
  // 3 contexts + wait for cross-node propagation), but far below the old
  // 240s: a genuinely broken test should not grind for 4 minutes.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // Multi-node CRDT stories are legitimately timing-sensitive: a peer can
  // lose one discovery/sync race and win it on the next attempt. Retry twice
  // so true flakiness self-heals IN-RUN (seconds) instead of failing the gate
  // and burning an LLM verify-heal cycle. This does NOT hide regressions — a
  // genuinely broken test fails all 3 attempts; only real flakes are rescued.
  // `trace: 'on-first-retry'` below captures the first failure for debugging.
  retries: 2,
  workers: WORKERS,
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

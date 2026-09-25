import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Records the landing page's clips (`pnpm landing:media`). Same global setup as
 * the e2e suite — real merod nodes with the app installed — but only the
 * recordings, one at a time, because each clip holds its chapters to a fixed
 * length and two recordings sharing a machine slow each other past it.
 */
export default defineConfig({
  ...base,
  testDir: './e2e/media',
  testIgnore: [],
  timeout: 300_000,
  workers: 1,
});

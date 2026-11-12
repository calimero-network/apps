import { defineConfig } from 'vitest/config';

// Standalone test config (not the app's vite.config). Unit tests cover pure
// logic in node; a file marked `@vitest-environment jsdom` renders screens against a mocked CalimeroClient.
export default defineConfig({
  test: {
    environment: 'node',
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ['@calimero-apps/test-setup'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

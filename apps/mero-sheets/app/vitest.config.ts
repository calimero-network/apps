import { defineConfig } from 'vitest/config';

// Standalone test config (not the app's vite.config, which loads the node
// polyfill plugin). Unit tests cover pure logic — invitation codec + blob
// helpers — and run in a jsdom-free node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

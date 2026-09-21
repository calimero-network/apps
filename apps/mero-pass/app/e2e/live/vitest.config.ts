import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/live/**/*.live.test.ts'],
    testTimeout: 180000,
    hookTimeout: 180000,
    server: { deps: { inline: [/@calimero-network\/mero-platform/] } },
  },
});

import { defineConfig } from 'vitest/config';

// Standalone test config (not the app's vite.config, which loads the node
// polyfill plugin). Unit tests cover pure logic — invitation codec + blob
// helpers — and run in a jsdom-free node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        // The platform SDK ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

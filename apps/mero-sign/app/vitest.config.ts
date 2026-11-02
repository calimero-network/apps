import { defineConfig } from 'vitest/config';

// Separate from `vite.config.js` on purpose: that config loads
// `vite-plugin-node-polyfills` and the Tailwind plugin for the browser bundle,
// none of which the unit tests need, and a JS config file cannot carry the
// `test` block's types.
//
// The pure logic, the contract wrapper against the committed ABI, and the
// screens against a mocked `CalimeroClient`.
export default defineConfig({
  test: {
    // `node` by default; a page test opts into `jsdom` with a
    // `// @vitest-environment jsdom` comment of its own.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

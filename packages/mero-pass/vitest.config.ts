import { defineConfig } from 'vitest/config';

// Node, not jsdom: the same code has to run in an agent's process, so the tests
// prove it needs nothing but Node's own `globalThis.crypto`.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});

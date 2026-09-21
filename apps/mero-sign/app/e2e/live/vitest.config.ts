import { defineConfig } from 'vitest/config';

// Separate from the app's `vitest.config.ts`, whose `include` is
// `src/**/*.test.ts` — so `pnpm test` (and therefore CI) never picks these up.
// They need a running merod with this app installed; see the note at the top
// of `workspaces.live.test.ts`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/live/**/*.live.test.ts'],
    // A namespace join waits on key delivery, and a cold node takes a few
    // seconds to answer its first admin call.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    server: {
      deps: { inline: [/@calimero-network\/mero-platform/] },
    },
  },
});

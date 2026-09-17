import { defineConfig } from 'vitest/config';

// Standalone test config (not the app's vite.config, which loads the node
// polyfill plugin). Unit tests cover pure logic — the invite codec and links,
// blob helpers, the spreadsheet engine — and run in a jsdom-free node
// environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: {
      deps: {
        // `@calimero-network/mero-platform@0.1.0` ships an ESM entry that does
        // `export … from "./bridge"` — a directory import with no extension.
        // Bundlers resolve that; Node's ESM resolver refuses it outright, so
        // vitest's node-side resolution fails the whole suite with
        // "Directory import ... is not supported". Inlining routes it through
        // Vite's transform instead, which is how the app itself loads it.
        //
        // Remove when the SDK publishes explicit extensions; nothing here works
        // around a bug in our own code.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

import { defineConfig } from 'vitest/config';

// Separate from `vite.config.js` on purpose: that config loads
// `vite-plugin-node-polyfills` and the Tailwind plugin for the browser bundle,
// none of which the unit tests need, and a JS config file cannot carry the
// `test` block's types.
//
// What is tested here is the pure logic only — the invitation codec, the link
// builder/parser and the name-resolution rules. The parts that talk to a node
// are not mocked and not asserted: a mocked wire-shape test cannot see a closed
// request body, so pretending otherwise would be worse than the gap.
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
        // "Directory import … is not supported". Inlining routes it through
        // Vite's transform instead, which is how the app itself loads it.
        //
        // Remove when the SDK publishes explicit extensions; nothing here works
        // around a bug in our own code.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  // App version (from package.json), shown in the header — so a bug report from
  // a tester says WHICH build they were on.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    /**
     * A port of this app's OWN, and a hard failure if it is taken.
     *
     * 5173 is vite's default, so every app that never pinned one took it — and
     * two apps on one origin share a `localStorage`. Opening this app after
     * another on 5173 inherits that app's mero-react session AND its
     * application id, so every namespace read is scoped to the wrong app: the
     * list looks like it is ignoring its filter when it is filtering correctly,
     * for something else.
     *
     * `strictPort` because the fallback is the same bug wearing a different
     * number: vite silently moves to the next free port, which is another app's
     * pinned one.
     */
    port: Number(process.env.PW_PORT) || 5185,
    strictPort: true,
  },
  build: { outDir: "dist" },
  test: {
    // src only — `tests/` holds @playwright/test specs, which vitest must not
    // collect (it fails as "did not expect test.describe() to be called here").
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    server: {
      deps: {
        // `@calimero-network/mero-platform@0.1.0` ships an ESM entry that does
        // `export … from "./bridge"` — a directory import with no extension.
        // Bundlers resolve that; Node's ESM resolver refuses it outright, so
        // vitest's node-side resolution fails the whole suite with "Directory
        // import ... is not supported". Inlining routes it through Vite's
        // transform instead, which is how the app itself loads it.
        //
        // Remove when the SDK publishes explicit extensions; nothing here works
        // around a bug in our own code.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

import react from "@vitejs/plugin-react";
// vitest's defineConfig, not vite's — only it accepts the `test` key.
import { defineConfig } from "vitest/config";

// `dist`, not `build`: the fleet's Vercel projects and this repo's .gitignore
// both assume Vite's default. The old value came from a Create React App
// lineage along with a gh-pages deploy that no longer exists.
//
// The node polyfill plugin is gone too — nothing in src/ needs it, and it was
// pulling a browserify shim set into every bundle.
export default defineConfig({
  base: "/",
  plugins: [react()],
  // ── Pin the dev port ────────────────────────────────────────────────────────
  //
  // Two apps served from one origin share a `localStorage`, and mero-react
  // keeps the session — including the application id — in it. So opening Mero
  // Pass on a port another mero app just used inherits THAT app's session, and
  // every namespace read comes back scoped to the wrong application: the space
  // list shows someone else's spaces and looks like it is ignoring the filter.
  //
  // `strictPort` is the half that matters. Without it Vite silently walks to
  // the next free port when this one is taken, which puts the app on a
  // neighbour's origin — the exact collision the pin exists to prevent — and
  // says so only in a line of startup output nobody reads.
  //
  // 5173/5174/5176/5177/5178/5180/5181/5183/5184/5185 are spoken for by other
  // apps in this monorepo.
  server: { port: 5182, strictPort: true },
  preview: { port: 5182, strictPort: true },
  build: { outDir: "dist" },
  test: {
    // Only src/. `tests/` holds @playwright/test specs, and vitest collecting
    // one fails as "Playwright Test did not expect test.describe() to be called
    // here" — the same symptom as having two Playwright copies installed, from
    // an unrelated cause.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    server: {
      deps: {
        // `@calimero-network/mero-platform@0.1.0` ships an ESM entry that does
        // `export … from "./bridge"` — a directory import with no extension.
        // Bundlers resolve that; Node's ESM resolver refuses it outright, so
        // vitest's node-side resolution fails the WHOLE suite with "Directory
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

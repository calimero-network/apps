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
  },
});

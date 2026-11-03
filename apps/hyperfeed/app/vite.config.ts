// `defineConfig` from `vitest/config`, not from `vite`: vite's own type has no
// `test` key, so a `test` block under the vite import fails `tsc -b`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative, so the same build runs at / and under the cluster's /{version}/,
  // where it serves the bundle's frontend.
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [react()],
  server: {
    // `pnpm dev:local hyperfeed` runs the dev server on exactly this port: a
    // merod local cluster trusts passkey ceremonies from http://localhost:5173.
    port: 5173,
    strictPort: true,
  },
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // `tsc -b` writes declarations under dist-types/; without this vitest also
    // runs the compiled copies of the tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
  },
});

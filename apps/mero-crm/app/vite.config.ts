// `defineConfig` from `vitest/config`, not from `vite`: vite's own type has no
// `test` key, so a `test` block under the vite import fails `tsc -b`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/,
  // where the cluster serves the bundle's frontend.
  base: "./",
  plugins: [react(), servedAssetsFallback()],
  // `pnpm dev:local` opens exactly http://localhost:5173/: the origin
  // `merod local` trusts passkey ceremonies from.
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    // App.test.tsx waits on chains of mocked requests; a parallel run is slow.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // `tsc -b` writes declarations under dist-types/; without this vitest also
    // runs the compiled copies of the tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
  },
});

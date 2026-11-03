// `defineConfig` from `vitest/config`, not from `vite` — vite's own
// `UserConfigExport` has no `test` key, so a `test` block under the vite import
// fails `tsc -b` with "Object literal may only specify known properties".
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/,
  // where the cluster serves the bundle's frontend.
  base: "./",
  plugins: [servedAssetsFallback(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // `tsc -b` writes declarations under dist-types/. Without this, vitest
    // discovers the compiled copies of the test files and runs them a second
    // time, from a directory where their relative paths no longer resolve.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
  },
});

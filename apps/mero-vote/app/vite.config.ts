// `defineConfig` from `vitest/config`, not from `vite`: vite's own type has no
// `test` key, so a `test` block under the vite import fails `tsc -b`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { installableApp } from "@calimero-apps/install/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/,
  // where the cluster serves the bundle's frontend.
  base: "./",
  plugins: [installableApp({ cacheId: "mero-vote" }), react()],
  test: {
    environment: "jsdom",
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ["@calimero-apps/test-setup", "./src/test/setup.ts"],
    // `tsc -b` writes declarations under dist-types/; without this vitest also
    // runs the compiled copies of the tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
  },
});

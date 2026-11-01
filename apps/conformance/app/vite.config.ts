// `defineConfig` from `vitest/config`, not from `vite`: vite's own type has no
// `test` key, so a `test` block under the vite import fails `tsc -b`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/,
  // where the cluster serves the bundle's frontend.
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // `tsc -b` writes declarations under dist-types/; without this vitest also
    // runs the compiled copies of the tests. `cluster/` needs a running
    // cluster: `pnpm test:cluster` (vitest.cluster.config.ts) runs it.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**", "cluster/**"],
  },
});

// `defineConfig` from `vitest/config`, not from `vite`: vite's own type has no
// `test` key, so a `test` block under the vite import fails `tsc -b`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative: the cluster serves this page at `https://{label}.apps.calimero.network/{version}/`.
  base: "./",
  plugins: [react()],
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

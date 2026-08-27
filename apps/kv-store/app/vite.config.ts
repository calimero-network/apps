// `defineConfig` from `vitest/config`, not from `vite` — vite's own
// `UserConfigExport` has no `test` key, so a `test` block under the vite import
// fails `tsc -b` with "Object literal may only specify known properties".
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // `tsc -b` writes declarations under dist-types/. Without this, vitest
    // discovers the compiled copies of the test files and runs them a second
    // time, from a directory where their relative paths no longer resolve.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
    server: {
      deps: {
        // ⚠️ @calimero-network/mero-platform@0.1.0 ships DIRECTORY imports
        // (`from "./bridge"` with no /index.js), which Node's ESM resolver
        // rejects outright:
        //
        //     Error: Directory import '.../dist/bridge' is not supported
        //     resolving ES modules
        //
        // Vite's dev server and its build both resolve them fine, so this only
        // ever breaks under vitest — i.e. the app runs and only the tests fail,
        // which reads like a test-harness problem rather than a packaging one.
        // Inlining routes the package through Vite's resolver instead of Node's.
        //
        // Remove when mero-platform publishes explicit file extensions.
        inline: [
          "@calimero-network/mero-platform",
          "@calimero-network/mero-platform-react",
        ],
      },
    },
  },
});

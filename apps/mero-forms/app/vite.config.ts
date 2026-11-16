// `defineConfig` from `vitest/config`, not from `vite` — vite's own
// `UserConfigExport` has no `test` key, so a `test` block under the vite import
// fails `tsc -b` with "Object literal may only specify known properties".
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";
import { installableApp } from "@calimero-apps/install/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  plugins: [installableApp({ cacheId: "mero-forms" }), servedAssetsFallback(), react()],
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-forms` passes it too). `strictPort` so a busy port
    // fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ["@calimero-apps/test-setup", "./src/test/setup.ts"],
    // `tsc -b` writes declarations under dist-types/; `e2e/` holds only the
    // generated landing spec (Playwright, not run here).
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**", "**/e2e/**"],
  },
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  plugins: [react(), servedAssetsFallback()],
  // App version (from package.json), shown in the header — so a bug report from
  // a tester says WHICH build they were on.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-forum` passes it too). `strictPort` so a busy port
    // fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
  build: { outDir: "dist" },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});

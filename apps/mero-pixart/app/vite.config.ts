import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

// Relative, so the same build runs at / and under the path the cluster serves
// the bundle's frontend from. `pnpm dev:local mero-pixart` runs this on
// http://localhost:5173, the origin `merod local` trusts passkeys from.
export default defineConfig({
  base: "./",
  test: {
    environment: "jsdom",
    globals: true,
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ["@calimero-apps/test-setup", "./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
  plugins: [react(), servedAssetsFallback()],
});

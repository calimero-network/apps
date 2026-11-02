import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-design` passes it too). `strictPort` so a busy port
    // fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
  plugins: [servedAssetsFallback(), react()],
});

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";
import { calimeroCsp } from "@calimero-apps/cloud/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  server: {
    port: 5176,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["**/node_modules/**", "**/e2e/**"],
    server: {
      deps: {
        // The platform SDK ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
  plugins: [calimeroCsp(), react(), servedAssetsFallback()],
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

// Mero Calendar — served at the web root (no GitHub-Pages `/plantr/` base).
// node polyfills are kept because the calimero/mero stack reaches for a few
// node globals (Buffer, process) during bundling.
export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  server: {
    port: 5174,
    strictPort: false,
  },
  plugins: [nodePolyfills(), react(), servedAssetsFallback()],
});

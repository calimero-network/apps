import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Mero Calendar — served at the web root (no GitHub-Pages `/plantr/` base).
// node polyfills are kept because the calimero/mero stack reaches for a few
// node globals (Buffer, process) during bundling.
export default defineConfig({
  server: {
    port: 5174,
    strictPort: false,
  },
  plugins: [nodePolyfills(), react()],
});

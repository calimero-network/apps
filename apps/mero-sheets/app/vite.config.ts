import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { servedAssetsFallback } from '@calimero-apps/node-served/vite';

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: './',
  plugins: [react(), servedAssetsFallback()],
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-sheets` serves it there). `strictPort` so a busy
    // port fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
});

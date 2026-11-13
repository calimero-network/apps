import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import { servedAssetsFallback } from '@calimero-apps/node-served/vite';
import { installableApp } from "@calimero-apps/install/vite";

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-sign` serves it there). `strictPort` so a busy
    // port fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    // ⚠️ No `rollupOptions.input`. It used to name two entries — index.html and
    // `public/404.html` — which is what emitted a static 404.html into dist and
    // ALSO produced a stray nested dist/public/. Vercel serves a static
    // 404.html in preference to the SPA rewrite in vercel.json, so every deep
    // link on this app returned HTTP 404 with a GitHub Pages redirect shim.
    // Vite's default single-entry behaviour is what the other fifteen apps use.
  },
  plugins: [installableApp({ cacheId: "mero-sign" }), servedAssetsFallback(), nodePolyfills(), react(), tailwindcss()],
});

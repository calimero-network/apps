import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    // PINNED, and not 5173. Every mero app served from the same origin shares one
    // localStorage, so running this on a port another Calimero app had used
    // inherited that app's session — you were logged in as whoever was last
    // here, with THEIR application id. One port per app makes that impossible.
    // 5188 is this app's, and it is what playwright.config.ts already claims.
    //
    // `strictPort` because the failure mode of NOT having it is silent and
    // expensive: vite picks the next free port, and the screenshots you take are
    // sharp, working, and of a different product.
    port: Number(process.env.PW_PORT) || 5188,
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
  plugins: [nodePolyfills(), react(), tailwindcss()],
});

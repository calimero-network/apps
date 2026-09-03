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

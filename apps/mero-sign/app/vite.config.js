import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/,
  // where the cluster serves the bundle's frontend.
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    // Exactly :5173: `merod local` trusts passkey ceremonies from
    // http://localhost:5173 (and :3000) only. `pnpm dev:local mero-sign` runs it.
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
  plugins: [nodePolyfills(), react(), tailwindcss()],
});

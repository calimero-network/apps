import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
  base: '/',
  build: {
    // Match battleships (apps/battleships/app/vite.config.js): outDir
    // is `build`, not the vite default `dist`. Keeps downstream deploy
    // scripts consistent across Calimero sample apps.
    outDir: 'build',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        404: resolve(__dirname, 'public/404.html'),
      },
      output: {
        manualChunks: {
          // Core React
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // TipTap editor
          'vendor-tiptap': [
            '@tiptap/react',
            '@tiptap/starter-kit',
            '@tiptap/extension-highlight',
            '@tiptap/extension-link',
            '@tiptap/extension-placeholder',
            '@tiptap/extension-text-align',
            '@tiptap/extension-underline',
          ],
          // Calimero SDK
          'vendor-calimero': [
            '@calimero-network/mero-react',
            '@calimero-network/mero-ui',
          ],
          // UI components
          'vendor-ui': [
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-slot',
            '@radix-ui/react-tooltip',
            'lucide-react',
          ],
        },
      },
    },
  },
  plugins: [nodePolyfills(), react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});

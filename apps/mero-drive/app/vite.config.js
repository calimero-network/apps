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
    // Vitest's default `include` picks up every `*.spec.ts` in the
    // tree — which would scoop our Playwright specs under `e2e/`
    // into the unit-test runner and fail them immediately on
    // `@playwright/test` import. Playwright owns its own runner; we
    // only want vitest to see `src/` here.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'build/**', 'dist/**'],
  },
  base: '/',
  build: {
    // Match battleships (apps/battleships/app/vite.config.js): outDir
    // is `build`, not the vite default `dist`. Keeps downstream deploy
    // scripts consistent across Calimero sample apps.
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        // Function form, not the object form. The object form names a chunk
        // for a package *and everything Rollup decides to co-locate with it*.
        // It put clsx, react-dom/client and vite's own preload helper inside
        // `vendor-blocknote`, so the entry chunk statically imported the 1.2MB
        // editor bundle and index.html preloaded it — defeating the lazy()
        // boundary around DocumentEditor and making every visitor to the
        // landing page download the editor. The function form only ever
        // reassigns files under node_modules, leaving shared first-party and
        // helper modules in the entry graph where they belong.
        //
        // Trailing separators matter: `react/` must not swallow `react-dom/`.
        manualChunks(id) {
          // Vite's own dynamic-import preload helper is a virtual module used
          // by the entry (to call the lazy import) and by every lazy chunk.
          // Unassigned, Rollup merges such shared modules into their largest
          // consumer — which was the editor chunk, pulling it into the entry
          // graph. Pin it somewhere the entry already loads.
          if (id.includes('vite/preload-helper')) return 'vendor-shared';
          if (!id.includes('node_modules')) return;
          const m = /[\\/]node_modules[\\/](?:\.pnpm[\\/].*?[\\/]node_modules[\\/])?(.+)$/.exec(
            id,
          );
          const pkgPath = m ? m[1] : '';
          if (
            /^(?:@blocknote|@mantine|prosemirror-[^\\/]*|y-prosemirror|yjs|y-protocols|lib0)[\\/]/.test(
              pkgPath,
            )
          ) {
            return 'vendor-blocknote';
          }
          if (/^(?:react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(pkgPath)) {
            return 'vendor-react';
          }
          if (/^@calimero-network[\\/]/.test(pkgPath)) return 'vendor-calimero';
          if (/^(?:@radix-ui|lucide-react)[\\/]/.test(pkgPath)) return 'vendor-ui';
          // Tiny styling utils that both the shell and the editor import. Same
          // merge hazard as the preload helper above, so pin them too.
          if (
            /^(?:clsx|tailwind-merge|class-variance-authority)[\\/]/.test(pkgPath)
          ) {
            return 'vendor-shared';
          }
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

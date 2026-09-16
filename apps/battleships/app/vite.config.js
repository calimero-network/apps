/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
  },
  plugins: [nodePolyfills(), react()],
  test: {
    // Playwright specs in e2e/ run under `playwright test`, not vitest,
    // and would crash here. Keep vitest scoped to src.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'build', 'e2e'],
    server: {
      deps: {
        // ⚠️ @calimero-network/mero-platform@0.1.0 ships DIRECTORY imports
        // (`from "./bridge"` with no /index.js), which Node's ESM resolver
        // rejects outright:
        //
        //     Error: Directory import '.../dist/bridge' is not supported
        //     resolving ES modules
        //
        // Vite's dev server and its build both resolve them fine, so this only
        // ever breaks under vitest — the app runs and only the tests fail,
        // which reads like a test-harness problem rather than a packaging one.
        // Inlining routes the package through Vite's resolver instead of Node's.
        //
        // Remove when mero-platform publishes explicit file extensions.
        inline: [
          '@calimero-network/mero-platform',
          '@calimero-network/mero-platform-react',
        ],
      },
    },
  },
});

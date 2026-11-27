/**
 * The service worker, built on its own after the pages (`pnpm build`) into the
 * same dist/. A service worker may not `import()` (Chrome refuses it on
 * ServiceWorkerGlobalScope), and mero-js loads its TEE quote verifier that
 * way, so every dynamic import is inlined into one file here.
 */
import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    modulePreload: false,
    copyPublicDir: false,
    chunkSizeWarningLimit: 4_000,
    rollupOptions: {
      input: resolve(root, "src/background/index.ts"),
      output: {
        format: "es",
        entryFileNames: "background.js",
        inlineDynamicImports: true,
      },
    },
  },
});

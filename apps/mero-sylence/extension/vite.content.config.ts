/**
 * The call page's speaker reader (src/content/speakers.ts), built on its own
 * into dist/speakers.js: `chrome.scripting.executeScript` runs a file as a
 * classic script, so it is one self-contained IIFE.
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
    lib: { entry: resolve(root, "src/content/speakers.ts"), formats: ["iife"], name: "sylenceSpeakers", fileName: () => "speakers.js" },
  },
});

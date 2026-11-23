// `defineConfig` from `vitest/config`: the `test` block below.
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { buildManifest } from "./src/manifest";

const root = import.meta.dirname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

/** onnxruntime-web's dist/, as transformers.js resolves it (pnpm keeps it beside transformers). */
function ortDir(): string {
  const transformers = realpathSync(join(root, "node_modules/@huggingface/transformers"));
  const fromTransformers = createRequire(join(transformers, "package.json"));
  return dirname(fromTransformers.resolve("onnxruntime-web"));
}

function extension(): Plugin {
  return {
    name: "minutes-extension",
    apply: "build",
    generateBundle() {
      const key = readFileSync(join(root, "manifest-key.txt"), "utf8").trim();
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(buildManifest({ key, version: pkg.version }), null, 2)}\n`,
      });
    },
  };
}

/** The service worker is its own build: vite.background.config.ts. */
export default defineConfig({
  base: "./",
  plugins: [react(), extension()],
  // The ONNX runtime transformers.js loads (src/transcribe/worker.ts imports its
  // files by URL), bundled with the extension so no code is fetched at run time.
  resolve: { alias: { "@ort": ortDir() } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    // The model runtime is large by nature; the warning is noise here.
    chunkSizeWarningLimit: 4_000,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(root, "popup.html"),
        sidepanel: resolve(root, "sidepanel.html"),
        offscreen: resolve(root, "offscreen.html"),
        permission: resolve(root, "permission.html"),
      },
    },
  },
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    setupFiles: ["@calimero-apps/test-setup", "./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**", "**/e2e/**"],
  },
});

// `defineConfig` from `vitest/config`, not from `vite` — vite's own
// `UserConfigExport` has no `test` key, so a `test` block under the vite import
// fails `tsc -b` with "Object literal may only specify known properties".
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";
import { extensionDownload } from "./extensionDownload";
import type { Plugin } from "vite";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** onnxruntime-web's dist/, as transformers.js resolves it (pnpm keeps it beside transformers). */
function ortDir(): string {
  const transformers = realpathSync(join(import.meta.dirname, "node_modules/@huggingface/transformers"));
  const fromTransformers = createRequire(join(transformers, "package.json"));
  return dirname(fromTransformers.resolve("onnxruntime-web"));
}

/**
 * Link-preview crawlers need an absolute image URL. The build is relative
 * (`base: "./"`), so the address comes from the environment: `SITE_URL`, or
 * Vercel's production domain. Without either, the tags stay relative.
 */
function absoluteSocialImage(): Plugin {
  const host = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = host ? (host.startsWith("http") ? host : `https://${host}`).replace(/\/$/, "") : "";
  return {
    name: "absolute-social-image",
    transformIndexHtml(html) {
      if (!origin) return html;
      return html
        .replaceAll('content="./og.png"', `content="${origin}/og.png"`)
        .replace("<meta property=\"og:type\"", `<meta property="og:url" content="${origin}/" />\n    <meta property="og:type"`);
    },
  };
}

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  plugins: [absoluteSocialImage(), extensionDownload(), servedAssetsFallback(), react()],
  // The ONNX runtime the speech worker loads (src/ai/speech.worker.ts imports
  // its files by URL), bundled with the page so no code is fetched at run time.
  resolve: { alias: { "@ort": ortDir() } },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 4_000 },
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-sylence` passes it too). `strictPort` so a busy port
    // fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ["@calimero-apps/test-setup", "./src/test/setup.ts"],
    // `tsc -b` writes declarations under dist-types/; `e2e/` holds only the
    // generated landing spec (Playwright, not run here).
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**", "**/e2e/**"],
  },
});

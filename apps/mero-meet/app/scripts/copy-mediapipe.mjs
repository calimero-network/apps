// Copy the MediaPipe vision WASM runtime from node_modules into
// public/mediapipe/wasm so it is served from our own origin (the desktop
// webview's CSP blocks the MediaPipe CDN). Runs before dev/build.
//
// We copy only the runtime variants FilesetResolver.forVisionTasks actually
// loads (`vision_wasm_internal.*` SIMD + `vision_wasm_nosimd_internal.*`
// fallback) — the ES-module variant (~11MB) is unused, so we skip it.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(here, "..", "public", "mediapipe", "wasm");

const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

if (!existsSync(src)) {
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision not installed; skipping.");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`[copy-mediapipe] synced ${files.length} runtime files → public/mediapipe/wasm`);

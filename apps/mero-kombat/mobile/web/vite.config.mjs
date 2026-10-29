// Builds the game-only page the native apps bundle: the web app's engine
// (../../app/src/game) plus the bridge in src/, as one classic IIFE script and a
// static index.html (public/), so it loads from file:// / app assets with no
// module CORS and nothing fetched at runtime. Deliberately import-free: it runs
// with the web app's vite (`pnpm -F mero-kombat exec vite build -c …`), see
// ../scripts/build-web.sh.
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export default {
  root: here,
  publicDir: "public",
  logLevel: "warn",
  build: {
    outDir: process.env.KOMBAT_GAME_OUT || "dist",
    emptyOutDir: true,
    target: "es2019",
    minify: true,
    sourcemap: false,
    lib: {
      entry: "src/main.ts",
      formats: ["iife"],
      name: "MeroKombatGame",
      fileName: () => "game.js",
    },
  },
};

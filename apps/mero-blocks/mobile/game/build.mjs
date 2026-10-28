// Builds the game-only page the iOS and Android apps bundle: `assets/game/index.html` and one
// classic (non-module) script `assets/game/game.js`, three.js and the web app's engine inlined.
// A classic script loads from a file:// URL (iOS) and the app-assets origin (Android) alike; an
// ES module from file:// is refused on both. Run through ../scripts/build-game.sh, which installs
// the web app's dependencies first; the build uses the web app's own Vite and three.js, so the
// game is the engine the web build ships, not a copy.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../../app");
const out = join(here, "assets/game");

const require = createRequire(join(appDir, "package.json"));
const vite = await import(pathToFileURL(require.resolve("vite")).href);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await vite.build({
  configFile: false,
  root: here,
  logLevel: "warn",
  build: {
    outDir: out,
    emptyOutDir: false,
    target: "es2020",
    minify: true,
    sourcemap: false,
    copyPublicDir: false,
    reportCompressedSize: false,
    lib: {
      entry: join(here, "src/main.ts"),
      formats: ["iife"],
      name: "MeroBlocksGame",
      fileName: () => "game.js",
    },
  },
});

copyFileSync(join(here, "index.html"), join(out, "index.html"));
console.log(`built ${out}`);

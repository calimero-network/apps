import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";

/**
 * Build for the screenshot harness (see ../shots.mjs).
 *
 * The two hooks that need a node and a camera are ALIASED to fixture modules.
 * Everything else — CallPage, DataDialog, both CSS modules, lib/slots,
 * lib/capacity — is the production code, so the screenshots document the real
 * UI rather than a re-implementation of it.
 *
 * A separate config rather than a flag in the app's own: nothing here should be
 * reachable from a production build, and an alias that only applies "when an env
 * var is set" is one misconfigured deploy away from shipping the mock.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "./",
  plugins: [react()],
  // Mirrors the app's own `define`. Without it the pages throw
  // "__APP_VERSION__ is not defined" at render and the harness photographs a
  // blank page — which is exactly the failure the pageerror check exists for.
  define: {
    __APP_VERSION__: JSON.stringify("shots"),
  },
  resolve: {
    alias: [
      {
        find: /.*\/hooks\/useLiveStream$/,
        replacement: here("./useLiveStream.mock.ts"),
      },
      {
        find: /.*\/hooks\/useMeroStream$/,
        replacement: here("./useMeroStream.mock.ts"),
      },
      // The list pages talk to the node through these two. Aliasing them keeps
      // StreamsPage / RoomsPage / InviteSheet as production code while the data
      // is fixtures.
      {
        find: /.*\/lib\/groups$/,
        replacement: here("./groups.mock.ts"),
      },
      {
        find: "@calimero-network/mero-react",
        replacement: here("./meroReact.mock.ts"),
      },
    ],
  },
  build: { outDir: here("../../../data/shots-build"), emptyOutDir: true },
});

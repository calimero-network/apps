import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Build for the screenshot harness (see ../shots.mjs).
 *
 * The modules that need a node are ALIASED to fixture modules.
 * See the alias list below for exactly what is replaced.
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
      // The modules that reach a node are ALIASED to fixtures. Everything else
      // — FeedPage, PostPage, SpacesPage, ForumsPage, PostCard, CommentRow,
      // NicknameBar, InviteModal, the CSS and the toast layer — is production
      // code, so the screenshots document the real UI rather than a
      // re-implementation of it.
      { find: /.*\/lib\/forum$/, replacement: here("./forum.mock.ts") },
      { find: /.*\/lib\/nickname$/, replacement: here("./nickname.mock.ts") },
      { find: /.*\/lib\/session$/, replacement: here("./session.mock.ts") },
      { find: /.*\/lib\/groups$/, replacement: here("./groups.mock.ts") },
      {
        find: "@calimero-network/mero-react",
        replacement: here("./meroReact.mock.ts"),
      },
    ],
  },
  build: { outDir: here("../../../data/shots-build"), emptyOutDir: true },
});

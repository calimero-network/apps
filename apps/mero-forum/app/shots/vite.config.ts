import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A screenshot build: the real pages and CSS, with the node layer aliased out.
// `mero-react` is stubbed too — MeroProvider would otherwise try to reach a node
// on mount and the shell would render its unauthenticated state instead of the
// UI we want to look at.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^\.\.\/lib\/forum$/, replacement: resolve(__dirname, "forum.mock.ts") },
      { find: /^\.\/lib\/forum$/, replacement: resolve(__dirname, "forum.mock.ts") },
      { find: "@calimero-network/mero-react", replacement: resolve(__dirname, "meroReact.mock.ts") },
    ],
  },
});

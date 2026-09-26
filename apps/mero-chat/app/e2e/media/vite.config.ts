import { resolve } from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// A screenshot build: the real pages, hooks, api/ layer and CSS. Only
// `@calimero-network/mero-react` is aliased — its provider/session/live hooks
// are stubbed and its useMero() hands the app a fake MeroJs (fakeMero.ts), so
// the app's own dataSources run unchanged against an invented node.
export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, "../../public"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@calimero-network\/mero-react$/, replacement: resolve(__dirname, "meroReact.mock.tsx") },
    ],
  },
  build: { outDir: resolve(__dirname, "dist"), emptyOutDir: true },
});

/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import pkg from "./package.json" with { type: "json" };
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/.
  base: "./",
  plugins: [react(), servedAssetsFallback()],
  // App version (from package.json), shown in the diagnostics UI — so a capacity
  // run recorded in a report says WHICH build produced the numbers.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // 5173, exactly: `merod local` trusts passkey ceremonies from
    // http://localhost:5173 (and :3000), and `pnpm dev:local mero-stream`
    // prints this URL. Sessions are stored per app and per target
    // (`calimero-session:mero-stream:<target>`), so sharing the origin with
    // another app's dev server no longer leaks a session between them.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});

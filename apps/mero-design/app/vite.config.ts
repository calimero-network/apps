import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // A bundle is served under /{version}/, so it builds relative; hosted at the root, deep links need an absolute base.
  base: process.env.RELATIVE_BASE ? "./" : "/",
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["**/node_modules/**", "**/e2e/**"],
    server: {
      deps: {
        // The platform SDK ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
  plugins: [react()],
});

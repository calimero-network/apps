import react from "@vitejs/plugin-react";
// vitest's defineConfig, not vite's — only it accepts the `test` key.
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative, so the same build runs at / and under the node's /{version}/,
  // where the cluster serves the bundle's frontend.
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [react()],
  // `pnpm dev:local mero-pass` runs this dev server on exactly 5173: merod
  // local trusts passkey ceremonies from http://localhost:5173 (and :3000).
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { outDir: "dist" },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});

/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative, so the same build runs at / and under /{version}/, where a
  // Calimero cluster serves the bundle's frontend.
  base: "./",
  server: {
    // `pnpm dev:local merraria` runs the dev server on exactly this origin: a
    // merod local cluster trusts passkey ceremonies from it.
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

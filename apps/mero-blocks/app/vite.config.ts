/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative, so the same build runs at / and under the path the cluster
  // serves the bundle's frontend from.
  base: "./",
  server: {
    // `pnpm dev:local mero-blocks` passes `--port 5173 --strictPort`: the one
    // origin `merod local` trusts passkey ceremonies from.
    port: Number(process.env.PORT ?? 5173),
  },
  test: {
    environment: "jsdom",
    // The lighting flood-fill and chunk mesher suites do real voxel compute —
    // ~17s for both files locally, and slower under CI's `pnpm -r` contention
    // across every app's tests at once. These tests are correct, just heavy.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

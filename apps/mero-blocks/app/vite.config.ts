/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: Number(process.env.PW_PORT ?? process.env.PORT ?? 5183),
  },
  test: {
    environment: "jsdom",
    // The lighting flood-fill and chunk mesher suites do real voxel compute —
    // ~17s for both files locally, and slower under CI's `pnpm -r` contention
    // across every app's tests at once. vitest's 5s default per-test timeout
    // tips over there (never in isolation), reddening the workspace-wide
    // Frontend job on unrelated PRs. These tests are correct, just heavy.
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ["tests/**/*.test.ts"],
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
});

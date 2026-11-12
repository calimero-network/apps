import { defineConfig } from "vitest/config";

// Unit tests in jsdom. `e2e/` holds only the generated landing spec (Playwright,
// not run here).
export default defineConfig({
  test: {
    environment: "jsdom",
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ["@calimero-apps/test-setup"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});

import { defineConfig } from "vitest/config";

// Unit tests run in a jsdom environment, separate from the Playwright e2e suite
// (which lives in ./e2e and is excluded here).
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});

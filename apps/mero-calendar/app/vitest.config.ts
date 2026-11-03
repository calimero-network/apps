import { defineConfig } from "vitest/config";

// Unit tests in jsdom. `e2e/` holds only the generated landing spec (Playwright,
// not run here).
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});

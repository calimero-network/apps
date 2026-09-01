import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  test: {
    // src only — `tests/` holds @playwright/test specs, which vitest must not
    // collect (it fails as "did not expect test.describe() to be called here").
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});

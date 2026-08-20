import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    // `tests/` holds the Playwright suite, which must not be run by vitest.
    //
    // `scripts/` is .mjs on purpose: the contract-call checker reads the repo
    // off disk, and keeping it out of `src` keeps `node:fs` out of the app's
    // tsconfig (which has no @types/node) while still letting it run as a
    // plain `node scripts/check-contract-calls.mjs`.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.mjs"],
    exclude: ["**/node_modules/**", "tests/**"],
  },
});

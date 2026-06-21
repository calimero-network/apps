import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    port: 5176,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
  plugins: [react()],
});

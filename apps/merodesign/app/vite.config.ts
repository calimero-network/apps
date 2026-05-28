import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
  plugins: [react()],
});

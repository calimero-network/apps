/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: Number(process.env.PW_PORT ?? process.env.PORT ?? 5183),
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});

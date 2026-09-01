/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: Number(process.env.PW_PORT ?? process.env.PORT ?? 5184),
  },
  test: {
    server: {
      deps: {
        // The platform SDK ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});

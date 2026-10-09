import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // A port of this app's own, and a hard failure if it is taken: two apps on
    // one origin share a localStorage, and with it a mero-react session.
    port: Number(process.env.PW_PORT) || 5195,
    strictPort: true,
  },
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
    server: {
      deps: {
        // mero-platform's ESM entry has an extensionless directory import that
        // Node's resolver refuses; inlining routes it through Vite's transform.
        inline: ["@calimero-network/mero-platform"],
      },
    },
  },
});

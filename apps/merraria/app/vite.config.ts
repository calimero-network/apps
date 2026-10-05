/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: Number(process.env.PW_PORT ?? process.env.PORT ?? 5184),
  },
  resolve: {
    // One mero-js for the whole page. The app and mero-react both import it,
    // and the dev optimizer otherwise picks whichever copy it meets first —
    // which can be mero-react's older one, missing the account layer this app
    // imports (`does not provide an export named …` at boot). Resolved from
    // this package, so the app's own dependency is the one that runs.
    dedupe: ["@calimero-network/mero-js"],
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

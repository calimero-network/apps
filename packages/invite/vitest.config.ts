import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    server: {
      deps: {
        // mero-platform 0.1.0 ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite —
        // the same workaround every app in this repo carries.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

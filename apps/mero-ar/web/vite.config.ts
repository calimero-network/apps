import { defineConfig } from "vite";

// The cluster serves this page at `https://{label}.apps.calimero.network/{version}/`,
// so every asset is addressed relative to the page.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `dist`, not `build`: the fleet's Vercel projects and this repo's .gitignore
// both assume Vite's default. The old value came from a Create React App
// lineage along with a gh-pages deploy that no longer exists.
//
// The node polyfill plugin is gone too — nothing in src/ needs it, and it was
// pulling a browserify shim set into every bundle.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});

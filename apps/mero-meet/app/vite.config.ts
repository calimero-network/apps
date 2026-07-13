/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import pkg from "./package.json" with { type: "json" };

// Mero Meet is a desktop-first app: tauri-app opens it in a WebviewWindow and
// proxies node traffic through its Rust backend. On the plain web it renders a
// "download the desktop app" landing page (see src/App.tsx).
//
// The MediaPipe vision WASM runtime (camera background effects) is synced into
// public/mediapipe/wasm by scripts/copy-mediapipe.mjs (predev/prebuild) so it's
// served from our own origin — the desktop webview's CSP blocks the CDN.
export default defineConfig({
  plugins: [react()],
  // App version (from package.json), shown in the UI and stamped into copied
  // diagnostics logs — so bug reports from testers say WHICH build broke.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: Number(process.env.PW_PORT) || 5173,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

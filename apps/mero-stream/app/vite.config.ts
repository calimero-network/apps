/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import pkg from "./package.json" with { type: "json" };

// Mero Stream is a desktop-first Task-3 capacity probe: tauri-app opens it in a
// WebviewWindow and proxies node traffic through its Rust backend. On the plain
// web it renders a short "open from the desktop app" landing page (see
// src/App.tsx).
//
// Unlike Mero Meet there is NO WebRTC and NO MediaPipe here — the whole point of
// this app is to push captured luma frames THROUGH the Calimero contract (the
// contract encodes/decodes in WASM), so there are no external media runtimes to
// sync into public/.
export default defineConfig({
  plugins: [react()],
  // App version (from package.json), shown in the diagnostics UI — so a capacity
  // run recorded in a report says WHICH build produced the numbers.
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

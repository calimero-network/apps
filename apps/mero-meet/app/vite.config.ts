import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Mero Meet is a desktop-first app: tauri-app opens it in a WebviewWindow and
// proxies node traffic through its Rust backend. On the plain web it renders a
// "download the desktop app" landing page (see src/App.tsx).
//
// The MediaPipe vision WASM runtime (camera background effects) is synced into
// public/mediapipe/wasm by scripts/copy-mediapipe.mjs (predev/prebuild) so it's
// served from our own origin — the desktop webview's CSP blocks the CDN.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PW_PORT) || 5173,
    strictPort: false,
  },
});

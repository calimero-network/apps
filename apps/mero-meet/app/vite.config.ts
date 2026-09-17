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
    /**
     * A port of this app's OWN, and a hard failure if it is taken.
     *
     * 5173 is vite's default, so every app that never pinned one took it — and
     * two apps on one origin share a `localStorage`. Opening this app after
     * another on 5173 inherited that app's mero-react session AND its
     * application id, so every namespace read was scoped to the wrong app: the
     * room list looked like it was ignoring its filter when it was filtering
     * correctly, for something else.
     *
     * `strictPort` because the fallback is the same bug wearing a different
     * number: vite silently moves to the next free port, which is another app's
     * pinned one. Refusing to start says which port is busy; starting on a
     * neighbour's origin says nothing and misbehaves later.
     */
    port: Number(process.env.PW_PORT) || 5177,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    server: {
      deps: {
        // The platform SDK ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

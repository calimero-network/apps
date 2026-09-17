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
    // Pinned, and NOT 5173. Every mero app served from the same origin shares one
    // localStorage, so running this on the port another Calimero app had used
    // inherited that app's mero-react session — you were logged straight in as
    // whoever was last here, with THEIR application id, and the stream picker
    // then listed that app's namespaces. One port per app makes that impossible.
    // (Overridable for Playwright, which needs to pick its own.)
    port: Number(process.env.PW_PORT) || 5178,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    server: {
      deps: {
        // `@calimero-network/mero-platform@0.1.0` ships an ESM entry that does
        // `export … from "./bridge"` — a directory import with no extension.
        // Bundlers resolve that; Node's ESM resolver refuses it outright, so
        // vitest's node-side resolution fails the whole suite with "Directory
        // import ... is not supported". Inlining routes it through Vite's
        // transform instead, which is how the app itself loads it.
        //
        // Remove when the SDK publishes explicit extensions; nothing here works
        // around a bug in our own code.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
});

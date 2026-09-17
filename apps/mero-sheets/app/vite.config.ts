import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  server: {
    // Pinned, and NOT 5173. Every mero app served from the same origin shares one
    // `localStorage`, so running this on a port another Calimero app had used
    // inherits that app's mero-react session — you are logged straight in as
    // whoever was here last, with THEIR application id, and the workspace picker
    // then lists that app's namespaces. One port per app makes that impossible.
    //
    // 5173/5174/5176/5177/5178/5180/5181/5183/5184 are taken by other apps in
    // this monorepo. `strictPort` so a clash FAILS instead of silently sliding
    // onto the next port — which is the same collision by another route.
    // (Overridable for Playwright, which needs to pick its own.)
    port: Number(process.env.PW_PORT) || 5185,
    strictPort: !process.env.PW_PORT,
  },
});

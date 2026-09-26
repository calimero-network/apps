import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  server: {
    // PINNED, and `strictPort` so a clash fails loudly instead of silently
    // sliding to the next free port.
    //
    // Two mero apps served from one origin share a `localStorage`, so when Vite
    // quietly reassigns a port the app that lands on 5173 inherits whatever
    // session and application id the previous occupant left there. That is the
    // same failure `utils/appId` defends against from the other side, and it is
    // also how a run of e2e screenshots came back sharp and of the wrong
    // product. 5186 is this app's; 5173-5182 are taken by the others.
    port: 5186,
    strictPort: true,
  },
});

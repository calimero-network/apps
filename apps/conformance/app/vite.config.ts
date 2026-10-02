import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `MERO_JS_PATH=<a mero-js checkout, built>` runs the matrix against that
 * mero-js instead of the installed one — for a paired run against a mero-js
 * change, or a fix not released yet. mero-react is deduped onto the same
 * copy, so there is one signer on the page.
 */
const meroJs = process.env['MERO_JS_PATH'];

export default defineConfig({
  plugins: [react()],
  // With MERO_JS_PATH set, mero-react's own import of mero-js must land on the
  // same copy: two copies are two signers, possibly at two schemas.
  resolve: {
    dedupe: ['react', 'react-dom', '@calimero-network/mero-js'],
    alias: meroJs
      ? [{ find: /^@calimero-network\/mero-js$/, replacement: resolve(meroJs, 'dist/index.browser.mjs') }]
      : [],
  },
  // Loopback only, on the rig's own port: the rig is local, and other rigs on
  // this machine hold the usual dev ports.
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  preview: { host: '127.0.0.1', port: 5190, strictPort: true },
});

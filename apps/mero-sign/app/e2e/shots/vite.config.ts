import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Build for the screenshot harness (see ../shots.mjs).
 *
 * A separate config rather than a flag in the app's own: nothing here should be
 * reachable from a production build, and an alias that only applies "when an env
 * var is set" is one misconfigured deploy away from shipping the mock.
 *
 * Only the modules that reach a node are aliased. The pages, the CSS modules,
 * `lib/participants`, the header, the cards and every empty state are production
 * code, so a screenshot documents the real UI.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@calimero-network/calimero-client',
        replacement: here('./calimeroClient.mock.ts'),
      },
      // `useCalimero` moved out of the SDK and into `lib/useCalimero` when the
      // app left `calimero-client` (its provider ships a hardcoded connect
      // screen). Aliasing the SDK alone stopped intercepting the session, and
      // seven scenarios photographed a signed-out app instead of the UI they
      // name — which the harness caught, because every scenario waits for the
      // landmark it is about rather than for a timer.
      {
        find: /.*\/lib\/useCalimero$/,
        replacement: here('./calimeroClient.mock.ts'),
      },
      // `MeroProvider`/`LoginModal` reach a node the moment they mount.
      {
        find: '@calimero-network/mero-react',
        replacement: here('./meroReact.mock.ts'),
      },
      {
        find: /.*\/api\/agreementService$/,
        replacement: here('./services.mock.ts'),
      },
      {
        find: /.*\/api\/invitationJoin$/,
        replacement: here('./services.mock.ts'),
      },
      {
        find: /.*\/api\/documentService$/,
        replacement: here('./services.mock.ts'),
      },
      {
        find: /.*\/dataSource\/ClientApiDataSource$/,
        replacement: here('./services.mock.ts'),
      },
      {
        find: /.*\/dataSource\/nodeApiDataSource$/,
        replacement: here('./services.mock.ts'),
      },
      {
        find: /.*\/components\/PDFViewer$/,
        replacement: here('./pdfViewer.mock.ts'),
      },
      {
        find: /.*\/lib\/invitationIntents$/,
        replacement: here('./invitationIntents.mock.ts'),
      },
    ],
  },
  build: { outDir: here('../../../data/shots-build'), emptyOutDir: true },
});

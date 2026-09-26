import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Build for the screenshot harness (see ../shots.mjs).
 *
 * The modules that need a node are ALIASED to fixtures; everything else — the
 * pages, the components, the CSS modules, the roles logic — is production code,
 * so the screenshots document the real UI.
 *
 * A separate config rather than a flag in the app's own: nothing here should be
 * reachable from a production build, and an alias that only applies "when an
 * env var is set" is one misconfigured deploy away from shipping the mock.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  // The app's own public dir, so the self-hosted fonts load as they do live.
  publicDir: here('../../public'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /.*\/lib\/vaults$/, replacement: here('./vaults.mock.ts') },
      { find: /.*\/lib\/vault$/, replacement: here('./vault.mock.ts') },
      {
        find: /.*\/hooks\/useVaultSession$/,
        replacement: here('./session.mock.ts'),
      },
      {
        find: /.*\/hooks\/useApplicationId$/,
        replacement: here('./hooks.mock.ts'),
      },
      {
        find: /.*\/hooks\/useTeamCapabilities$/,
        replacement: here('./hooks.mock.ts'),
      },
      {
        find: '@calimero-network/mero-react',
        replacement: here('./meroReact.mock.ts'),
      },
    ],
  },
  build: { outDir: here('../../../data/shots-build'), emptyOutDir: true },
});

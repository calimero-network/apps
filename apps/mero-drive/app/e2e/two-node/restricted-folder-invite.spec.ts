// Restricted folder gating — tests 30-32 from the catalog.

import { test, expect } from '../fixtures/two-user';

test.describe('Restricted folder invite (two-node)', () => {
  test.skip(
    'Bob sees Restricted folder name but ask-admin card',
    async ({ alice, bob }) => {
      // Alice creates a Restricted folder. Bob joins the namespace.
      // Bob's tree shows the row (name is namespace-scope metadata),
      // but clicking it surfaces the "This folder is restricted"
      // card, NOT the Join CTA — distinguishes definitive-restricted
      // from sync-in-progress.
    },
  );

  test.skip('Bob copies identity from restricted card', async ({ bob }) => {
    // Asserts the copy affordance writes Bob's identity to clipboard.
  });

  test.skip(
    'Alice adds Bob\'s identity → Bob\'s card swaps to folder view',
    async ({ alice, bob }) => {
      // Bob copies identity. Alice opens the folder's
      // FolderSharingPanel, adds Bob's identity, hits Add. Bob's
      // RestrictedFolderCard unmounts and the real folder UI
      // mounts (DocumentList visible). Bob can read+write.
    },
  );
});

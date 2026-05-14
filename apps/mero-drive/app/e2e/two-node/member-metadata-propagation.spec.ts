// Member display name propagation — tests 40-42.

import { test, expect } from '../fixtures/two-user';

test.describe('Member metadata propagation (two-node)', () => {
  test.skip(
    'Alice\'s namespace display name visible to Bob',
    async ({ alice, bob }) => {
      // Alice sets her name in NamespaceSettingsPanel; Bob (member
      // of namespace) sees it in the sharing-panel member list and
      // in the FolderTree's member chips.
    },
  );

  test.skip(
    'Bob\'s display name visible to Alice',
    async ({ alice, bob }) => {
      // Symmetric — sanity check that propagation works in both
      // directions.
    },
  );

  test.skip(
    'Display name reflects in document author/owner',
    async ({ alice, bob }) => {
      // After both have names set, the doc-row "owner" label shows
      // the name rather than the truncated key.
    },
  );
});

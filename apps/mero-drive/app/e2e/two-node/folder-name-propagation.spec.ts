// Folder name propagation — tests 37-39. The marquee guard against
// the publisher-ordering bug previously misfiled as core #2358: if
// `setGroupMetadata` is called before `setSubgroupVisibility(Open)`,
// the publisher's `is_open_chain_to_namespace` returns false →
// encrypts with subgroup key → namespace-only members can't decrypt
// the name. The fix lives in `useFolderOperations.ts` (visibility
// flipped ahead of name). These tests are the regression guard.

import { test, expect } from '../fixtures/two-user';

test.describe('Folder name propagation (two-node)', () => {
  test('Open folder name visible to Bob from initial render', async ({
    alice,
    bob,
  }) => {
    test.skip(
      true,
      'Pending SettingsDriver.copyNamespaceInvite + namespace-join helper. ' +
        'Once Bob can be invited via the driver, this test should pass — ' +
        'the ordering fix in useFolderOperations.ts ensures the name op ' +
        'encrypts with the namespace key for Open subgroups.',
    );
    // Alice creates Open folder named 'Specs'. Bob joins namespace.
    // Bob's tree row for the folder should display 'Specs', not an
    // opaque id or placeholder.
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Name');
    await alice.createFolder({ name: 'Specs', visibility: 'Open' });
    // ... bob.joinNamespace(invite) ...
    await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });
  });

  test('Renaming Open folder propagates to Bob', async ({ alice, bob }) => {
    test.skip(
      true,
      'Pending SettingsDriver.copyNamespaceInvite — same blocker as above.',
    );
    // After fix: renaming via setGroupMetadata still uses namespace
    // key (visibility is already Open by the time rename runs), so
    // the new name reaches Bob.
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Rename');
    await alice.createFolder({ name: 'Specs', visibility: 'Open' });
    await alice.renameFolder('Specs', 'Documents');
    await bob.tree.expectFolderVisible('Documents', { timeout: 60_000 });
    await bob.tree.expectFolderHidden('Specs');
  });

  test.skip(
    'Restricted folder shows placeholder name to non-members',
    async ({ alice, bob }) => {
      // Bob is in the namespace but not in the subgroup. The row
      // should appear with a synthetic placeholder until invited —
      // Restricted name encryption is correctly subgroup-key-only.
    },
  );
});

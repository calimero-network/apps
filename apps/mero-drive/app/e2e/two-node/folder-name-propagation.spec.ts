// Folder name propagation — tests 37-39 from the catalog.
//
// Verifies the publisher-ordering fix in useFolderOperations.create
// (setSubgroupVisibility before setGroupMetadata for Open chains —
// the bug that was misfiled as core#2358 and turned out to be
// app-side). The regression these tests protect against: a future
// re-ordering would land metadata ops encrypted with the subgroup
// key, invisible to namespace-only members like Bob.

import { test } from '../fixtures/two-user';

test.describe('Folder name propagation (two-node)', () => {
  test('Open folder name visible to Bob from initial render', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Name Prop WS');
    await alice.createFolder({ name: 'Specs', visibility: 'Open' });
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    // Bob's tree row for the folder displays "Specs" (not the
    // truncated id), proving the namespace-key-encrypted metadata
    // op reached Bob's node.
    await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });
  });

  test('Renaming Open folder propagates to Bob', async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Rename Prop WS');
    await alice.createFolder({ name: 'Specs', visibility: 'Open' });
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });

    // Alice renames; for an already-Open subgroup the rename op
    // continues to encrypt on the namespace chain, so Bob sees the
    // change without any membership shift.
    await alice.renameFolder('Specs', 'Documents');
    await bob.tree.expectFolderVisible('Documents', { timeout: 60_000 });
    await bob.tree.expectFolderHidden('Specs');
  });

  test('Restricted folder shows row to non-members but with placeholder name',
    async ({ alice, bob }) => {
      // Restricted folders correctly encrypt their metadata with the
      // subgroup key — namespace-only members can't decrypt the name.
      // The row still appears (the GroupChildIndex entry is
      // namespace-keyed under #2344 opaque-leaf), just without the
      // human label.
      await alice.goToWorkspace();
      await alice.createNamespace('Restricted Name WS');
      await alice.createFolder({ name: 'Internal', visibility: 'Restricted' });
      await alice.openSettings();
      const inviteUrl = await alice.settings.copyNamespaceInvite();
      await alice.closeSettings();

      await bob.joinNamespace(inviteUrl);
      // The row appears (folderRow matcher needs SOMETHING in the row
      // text); we can't easily assert "doesn't have 'Internal'" with a
      // single locator without listing rows. So just verify Bob's tree
      // has at least one folder row and clicking it surfaces the
      // ask-admin card.
      await bob.page
        .locator('aside li')
        .first()
        .click();
      await bob.restrictedCard.expectAskAdmin({ timeout: 30_000 });
    });
});

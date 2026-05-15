// Folder tree propagation — tests 47-49. Verifies nested folder
// creation and deletion both replicate from Alice's node to Bob's.
// Reparent is deferred — the driver doesn't yet expose a reparent
// helper (the underlying admin-api endpoint is wired but the UI
// affordance is drag-driven).

import { test } from '../fixtures/two-user';

test.describe('Folder tree propagation (two-node)', () => {
  test('Nested folders created on Alice appear on Bob with same shape',
    async ({ alice, bob }) => {
      await alice.goToWorkspace();
      await alice.createNamespace('Tree Prop WS');

      // A → A/B → A/B/C (Open chain so Bob's tree shows the names).
      await alice.createFolder({ name: 'A', visibility: 'Open' });
      await alice.createFolder({ name: 'B', visibility: 'Open', parent: 'A' });
      await alice.createFolder({ name: 'C', visibility: 'Open', parent: 'B' });

      await alice.openSettings();
      const inviteUrl = await alice.settings.copyNamespaceInvite();
      await alice.closeSettings();

      await bob.joinNamespace(inviteUrl);
      await bob.tree.expectFolderVisible('A', { timeout: 60_000 });
      await bob.tree.expectFolderVisible('B', { timeout: 60_000 });
      await bob.tree.expectFolderVisible('C', { timeout: 60_000 });
    });

  test.skip('Reparenting A/B under root updates Bob\'s tree',
    async ({ alice, bob }) => {
      // The reparent affordance in the UI is drag-driven; once the
      // driver exposes reparentFolder this can re-activate.
      void alice;
      void bob;
    });

  test("Deleting A/B/C drops it from Bob's tree", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Delete Prop WS');
    await alice.createFolder({ name: 'A', visibility: 'Open' });
    await alice.createFolder({ name: 'B', visibility: 'Open', parent: 'A' });
    await alice.createFolder({ name: 'C', visibility: 'Open', parent: 'B' });

    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('C', { timeout: 60_000 });

    await alice.deleteFolder('C');
    await bob.tree.expectFolderHidden('C', { timeout: 60_000 });
    // A and B remain — verify the delete didn't cascade upward.
    await bob.tree.expectFolderVisible('A');
    await bob.tree.expectFolderVisible('B');
  });
});

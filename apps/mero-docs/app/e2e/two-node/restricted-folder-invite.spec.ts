// Restricted folder gating: the rail hides a Restricted folder from
// namespace members outside it until an admin adds them.

import { test } from '../fixtures/two-user';

test.describe('Restricted folder invite (two-node)', () => {
  test('Bob sees a Restricted folder only once Alice adds him', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Grant WS');
    await alice.createFolder({ name: 'Privileged', visibility: 'Restricted' });
    // Created after the Restricted one, so seeing it proves Bob's tree
    // already holds the Restricted folder's registry entry.
    await alice.createFolder({ name: 'Lobby', visibility: 'Open' });
    await alice.tree.openFolder('Privileged');
    await alice.createDoc('Secret Doc');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Lobby', { timeout: 60_000 });
    // Exact list: neither the name nor an id placeholder row leaks.
    await bob.tree.expectFolderList(['Lobby']);

    await alice.openFolderInfo('Privileged');
    await alice.sharing.addMember('bob');
    await alice.sharing.expectMemberVisible('bob');
    await alice.closeFolderInfo();

    await bob.tree.expectFolderVisible('Privileged', { timeout: 60_000 });
    await bob.tree.openFolder('Privileged');
    await bob.docs.expectDocVisible('Secret Doc', { timeout: 60_000 });
  });
});

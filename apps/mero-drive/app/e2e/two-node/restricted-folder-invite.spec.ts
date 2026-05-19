// Restricted folder gating — tests 30-32 from the design catalog.
//
// Complements `open-folder-inheritance.spec.ts`: the Open-path
// covers self-join via the inheritance walk; this spec covers the
// explicit-invite path that Restricted folders force you onto.

import { test, expect } from '../fixtures/two-user';

test.describe('Restricted folder invite (two-node)', () => {
  test('Bob sees Restricted folder name but ask-admin card', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Restricted WS');
    await alice.createFolder({ name: 'Confidential', visibility: 'Restricted' });
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Confidential', { timeout: 60_000 });

    await bob.tree.openFolder('Confidential');
    // Distinct from the syncing-state copy: this is the definitive
    // "you are not on the member list" state.
    await bob.restrictedCard.expectAskAdmin();
  });

  test("Bob copies identity from restricted card", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Identity WS');
    await alice.createFolder({ name: 'Locked', visibility: 'Restricted' });
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Locked');
    await bob.restrictedCard.expectAskAdmin();

    const identity = await bob.restrictedCard.copyIdentity();
    expect(identity).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/); // base58 pubkey shape
  });

  test("Alice adds Bob's identity → Bob's card swaps to folder view", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Grant WS');
    await alice.createFolder({ name: 'Privileged', visibility: 'Restricted' });
    await alice.tree.openFolder('Privileged');
    await alice.createDoc('Secret Doc');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    // Bob: join, navigate to the restricted folder, copy identity.
    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Privileged', { timeout: 60_000 });
    await bob.tree.openFolder('Privileged');
    const bobIdentity = await bob.restrictedCard.copyIdentity();

    // Alice: add Bob via the FolderSharingPanel.
    await alice.sharing.addMember(bobIdentity);
    await alice.sharing.expectMemberVisible(bobIdentity.slice(0, 12));

    // Bob: refresh his view → restricted card unmounts, doc list
    // mounts, can read Alice's doc.
    await bob.restrictedCard.clickRefresh();
    await bob.docs.expectDocVisible('Secret Doc', { timeout: 60_000 });
  });
});

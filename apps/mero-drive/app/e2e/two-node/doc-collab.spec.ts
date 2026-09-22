// One-way document propagation between two nodes.
//
// The sync mechanism is the docs.wasm CRDT layer plus mero-react's
// useSubscription wiring. These tests assert the user-visible outcome
// (eventually consistent text), not the internal sync timing, so their
// timeouts are generous.
//
// Concurrent merge is not here: it needs two causally independent edits,
// which means sequencing them through the rig's offline switch. The rich
// project owns that.

import { test } from '../fixtures/two-user';

test.describe('Document collab (two-node)', () => {
  test('Both Alice and Bob open the same doc concurrently', async ({
    alice,
    bob,
  }) => {
    // Setup: shared Open folder, one doc, Bob materializes
    // inheritance.
    await alice.goToWorkspace();
    await alice.createNamespace('Collab Setup');
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Joint');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted();
    await bob.docs.expectDocVisible('Joint');

    // Both open the same doc.
    await alice.openDoc('Joint');
    await bob.openDoc('Joint');
    await alice.editor.expectMounted();
    await bob.editor.expectMounted();
  });

  test("Alice's edits become visible to Bob", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('A-writes Setup');
    await alice.createFolder({ name: 'Pad', visibility: 'Open' });
    await alice.tree.openFolder('Pad');
    await alice.createDoc('A-writes');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Pad');
    await bob.restrictedCard.joinIfPrompted();
    await bob.openDoc('A-writes');

    await alice.openDoc('A-writes');
    await alice.editor.type('hello from alice');

    await bob.editor.expectContent('hello from alice', { timeout: 60_000 });
  });

  test("Bob's edits become visible to Alice", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('B-writes Setup');
    await alice.createFolder({ name: 'Pad', visibility: 'Open' });
    await alice.tree.openFolder('Pad');
    await alice.createDoc('B-writes');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Pad');
    await bob.restrictedCard.joinIfPrompted();
    await bob.openDoc('B-writes');

    await bob.editor.type('hello from bob');

    await alice.openDoc('B-writes');
    await alice.editor.expectContent('hello from bob', { timeout: 60_000 });
  });

  // merod rc.41 keys presence off the folder subgroup's own keyring, which an Open folder does not use, so set_ephemeral fails "no current group key".
  test.fixme("Each sees the other's named cursor", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Cursor Setup');
    await alice.createFolder({ name: 'Desk', visibility: 'Open' });
    await alice.tree.openFolder('Desk');
    await alice.createDoc('Pointer');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Desk');
    await bob.restrictedCard.joinIfPrompted();
    await bob.docs.expectDocVisible('Pointer');

    await alice.openDoc('Pointer');
    await bob.openDoc('Pointer');
    await alice.editor.type('here');
    await bob.editor.expectContent('here', { timeout: 60_000 });
    await bob.editor.type('!');

    await bob.editor.expectPeerCursor();
    await alice.editor.expectPeerCursor();
  });
});

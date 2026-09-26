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

import { expect, test } from '../fixtures/two-user';

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

  test('Each sees the other in the editor header', async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Avatars Setup');
    await alice.createFolder({ name: 'Room', visibility: 'Open' });
    await alice.tree.openFolder('Room');
    await alice.createDoc('Together');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Room');
    await bob.restrictedCard.joinIfPrompted();
    await bob.openDoc('Together');
    await alice.openDoc('Together');

    // A peer appears once it has a caret in the doc.
    await alice.editor.type('hi');
    await bob.editor.type('yo');
    const others = (p: typeof alice.page) =>
      p.getByRole('group', { name: /^Also here:/ });
    await expect(others(alice.page)).toBeVisible({ timeout: 60_000 });
    await expect(others(bob.page)).toBeVisible({ timeout: 60_000 });
    await expect(others(alice.page).locator('span')).toHaveCount(1);
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

  // FIXME — no longer the core bug this was parked for. On rc.41 presence
  // itself failed ("no current group key": presence keyed off the Open folder's
  // subgroup keyring); core#4027 in rc.42 fixed that, and on an rc.42 rig every
  // set_ephemeral now succeeds. What still fails is the caret's anchor:
  // `anchor_at` is refused with "provided string contained invalid character
  // '-' at byte 8" because useBodyCursors → useFugueBody.backendIdOf falls back
  // to the editor's own UUID for a block with no backend id mapped yet, and the
  // contract decodes `block` as a base58 token. No anchor, no slice, no cursor.
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

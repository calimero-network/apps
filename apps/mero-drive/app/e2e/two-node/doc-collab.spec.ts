// Real-time document collaboration — tests 43-46 from the catalog.
//
// The actual sync mechanism is the docs.wasm CRDT layer plus
// mero-react's useSubscription wiring. These tests assert the
// user-visible outcome (eventually consistent text), not the
// internal sync timing — they use generous timeouts because the
// docs context's wait_for_sync window can run long under load.

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

  // Concurrent-merge assertion — the headline guarantee of the Yjs collab
  // path: two people editing the SAME doc at the SAME time both end up with
  // BOTH contributions (a true CRDT merge), where the legacy LWW path would
  // have clobbered one writer's edits with the other's whole-snapshot save.
  //
  // The two-node project's dev server is built with `VITE_COLLAB_YJS=true`
  // (playwright.config.ts), so the collaborative editor is what mounts here.
  test('Concurrent edits MERGE (both writers survive) — Yjs collab path', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Merge Setup');
    await alice.createFolder({ name: 'Pad', visibility: 'Open' });
    await alice.tree.openFolder('Pad');
    await alice.createDoc('Merge');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Pad');
    await bob.restrictedCard.joinIfPrompted();
    await bob.docs.expectDocVisible('Merge');

    // Both open the same doc.
    await alice.openDoc('Merge');
    await bob.openDoc('Merge');
    await alice.editor.expectMounted();
    await bob.editor.expectMounted();

    // TRUE CONCURRENCY: both writers commit their edits to their OWN replica
    // BEFORE either side has had a chance to converge. We interleave the typing
    // and only THEN wait for convergence — so at the moment each side types,
    // it has NOT yet seen the other's text. A last-writer-wins store would drop
    // one side here; a CRDT merge keeps both. (We type at the start position on
    // each side so the two inserts genuinely overlap at offset 0.)
    await Promise.all([
      alice.editor.type('AAA-from-alice '),
      bob.editor.type('BBB-from-bob '),
    ]);

    // After the op-logs exchange via SSE + Yjs merge, BOTH sides converge to a
    // document containing BOTH contributions — neither writer is clobbered.
    await alice.editor.expectContent('AAA-from-alice', { timeout: 60_000 });
    await alice.editor.expectContent('BBB-from-bob', { timeout: 60_000 });
    await bob.editor.expectContent('AAA-from-alice', { timeout: 60_000 });
    await bob.editor.expectContent('BBB-from-bob', { timeout: 60_000 });
  });
});


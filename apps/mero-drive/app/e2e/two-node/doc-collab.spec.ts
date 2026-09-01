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
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.clickJoin();
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
    await bob.restrictedCard.clickJoin();
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
    await bob.restrictedCard.clickJoin();
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
  // Only meaningful when the collaborative editor is mounted, which is gated
  // behind `VITE_COLLAB_YJS=true` at the dev server. We gate at RUNTIME (inside
  // the test, via `collabEnabled()` read when the test runs) rather than via a
  // module-load const, because a top-level `process.env` read can be evaluated
  // before Playwright's env injection / config is fully applied — a runtime
  // read reliably reflects the flag CI sets on the two-node job. The flag is
  // forwarded to the Vite dev server via playwright.config.ts's webServer.env,
  // so the served app's `COLLAB_YJS_ENABLED` is actually on. With the flag off,
  // the editor is the LWW shell and concurrent edits are expected to clobber,
  // so we skip rather than assert a guarantee the mounted code doesn't make.
  //
  // NOTE: two-node browser e2e is infra-flaky in CI (cross-node gossip timing)
  // and Docker isn't available locally — this is authored to be correct and
  // compile-checked via `playwright test --list`; rely on CI to execute it.
  test('Concurrent edits MERGE (both writers survive) — Yjs collab path', async ({
    alice,
    bob,
  }) => {
    test.skip(
      !collabEnabled(),
      'collab editor disabled (VITE_COLLAB_YJS != true) — LWW shell clobbers, not merges',
    );

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
    await bob.restrictedCard.clickJoin();
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

// Runtime flag read — see the test above for why this is a function, not a
// module-load const. Mirrors the app's `COLLAB_YJS_ENABLED` parse.
function collabEnabled(): boolean {
  return (process.env.VITE_COLLAB_YJS ?? '').trim() === 'true';
}

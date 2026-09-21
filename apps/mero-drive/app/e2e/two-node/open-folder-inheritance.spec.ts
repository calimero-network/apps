// Marquee two-node test: Open-subgroup inheritance materialisation.
//
// The single most-broken regression-prone path in mero-drive. The
// chain that has to work for this test to pass:
//
//   - Alice creates namespace + Open folder + doc (ordering fix:
//     setSubgroupVisibility before setGroupMetadata, useFolderOperations).
//   - Alice generates a namespace invite; Bob accepts via /join.
//   - core gossips the namespace governance op to Bob's node
//     (#2261 inheritance walk recognises Bob as eligible).
//   - core auto-follow on Bob's node joins the Open folder's docs
//     context, so the folder view opens without a Join click.
//   - Bob reads Alice's doc; writes his own; Alice reads back (#2351
//     KeyDelivery + the underlying gossip/sync stack).
//
// Tests 27-29 from the design catalog.

import { test, expect } from '../fixtures/two-user';

test.describe('Open folder inheritance (two-node)', () => {
  // Minimal smoke test for the join-via-inheritance chain. Proves
  // the basic happy path:
  //
  //   node-1 creates Open subgroup + doc → invites to namespace
  //   node-2 accepts, sees the folder, opens it (auto-follow has
  //     already joined the docs context)
  //   node-2 sees Alice's doc in the DocumentList
  //
  // No editor mount, no bidirectional write-back, no concurrency —
  // those are covered by the next test in this file and by
  // doc-collab.spec.ts. First in file so it runs first; a failure
  // here means everything downstream is moot.
  test('SMOKE: node-2 joins Open subgroup via inheritance + reads doc', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Smoke WS');
    await alice.createFolder({ name: 'OpenSpace', visibility: 'Open' });
    // Create the doc BEFORE inviting so when Bob lands in the
    // folder view he can see it immediately — keeps the smoke
    // strictly forward-only (no cross-node write).
    await alice.tree.openFolder('OpenSpace');
    await alice.createDoc('Smoke Doc');

    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    // node-2: accept invite → namespace member.
    await bob.joinNamespace(inviteUrl);

    // node-2 sees the Open folder (namespace-scope metadata reached
    // Bob's node via the gossip layer; depends on the publisher-
    // ordering fix in useFolderOperations.create).
    await bob.tree.expectFolderVisible('OpenSpace', { timeout: 60_000 });

    await bob.tree.openFolder('OpenSpace');
    await bob.restrictedCard.joinIfPrompted();

    // Bob can see Alice's doc (the docs-context CRDT replicated to
    // his node through the inherited membership).
    await bob.docs.expectDocVisible('Smoke Doc', { timeout: 60_000 });
  });

  test("Bob inherits Alice's Open folder created before he joined", async ({
    alice,
    bob,
  }) => {
    // Alice — namespace, folder, doc, invite link.
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Pre');
    await alice.createFolder({ name: 'Specs', visibility: 'Open' });
    await alice.tree.openFolder('Specs');
    await alice.createDoc('Alpha');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    // Bob — accept invite, see the folder, click Join, read Alice's
    // doc, write his own.
    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });

    await bob.tree.openFolder('Specs');
    await bob.restrictedCard.joinIfPrompted();

    await bob.docs.expectDocVisible('Alpha');

    await bob.createDoc('Beta');
    await alice.docs.expectDocVisible('Beta', { timeout: 60_000 });
  });

  // The Join card only shows while the caps probe still says "not a member"
  // (propagation lag); forcing that proves its click goes through join-via-inheritance.
  test('Join folder hits /join-via-inheritance (wire-shape guard)', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Wire');
    await alice.createFolder({ name: 'Wire', visibility: 'Open' });
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Wire', { timeout: 60_000 });

    let calledJoinInheritance = false;
    await bob.page.route(
      '**/admin-api/groups/*/join-via-inheritance',
      async (route) => {
        calledJoinInheritance = true;
        await route.continue();
      },
    );
    await bob.page.route(
      '**/admin-api/groups/*/members/*/capabilities',
      async (route) => {
        if (calledJoinInheritance) return route.continue();
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'identity is not a member of group' }),
        });
      },
    );

    await bob.tree.openFolder('Wire');
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.joinIfPrompted();

    expect(calledJoinInheritance).toBe(true);
  });

  test.skip(
    'Open folder created AFTER Bob joined appears on Bob without manual refresh',
    async ({ alice, bob }) => {
      // Same flow as above but: invite Bob first, then create the
      // folder. Asserts Bob's tree refreshes via subscription rather
      // than poll. Pending a stable subscription-vs-poll signal in
      // the workspace state.
      void alice;
      void bob;
    },
  );

  test.skip(
    'RestrictedFolderCard shows syncing pre-visibility-op; swaps to Join CTA',
    async ({ alice, bob }) => {
      // Race: open the card view before the visibility op has
      // reached Bob's node. Card should show "Workspace is still
      // syncing" → "Try joining"; once the op arrives the heading
      // swaps to "Join this open folder" / "Join folder". Needs a
      // way to gate gossip propagation per-test.
      void alice;
      void bob;
    },
  );
});

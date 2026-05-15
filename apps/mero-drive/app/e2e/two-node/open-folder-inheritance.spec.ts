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
//   - Bob clicks "Join folder" → useJoinSubgroupInheritance(folderId)
//     (core #2360) → core publishes MemberJoinedOpen on Bob's behalf,
//     fetches the subgroup key via OpenSubgroupJoinRequest, returns 200.
//   - useFolderPermissions re-evaluates after refetch; RestrictedFolderCard
//     unmounts in favour of the DocumentList.
//   - Bob reads Alice's doc; writes his own; Alice reads back (#2351
//     KeyDelivery + the underlying gossip/sync stack).
//
// Tests 27-29 from the design catalog.

import { test, expect } from '../fixtures/two-user';

test.describe('Open folder inheritance (two-node)', () => {
  // Minimal smoke test for the join-via-inheritance chain. Proves
  // ONLY the basic happy path: node-1 creates an Open subgroup +
  // invites to the namespace; node-2 accepts, sees the folder,
  // clicks Join, and lands in the folder view (i.e. has access).
  // No doc create, no editor mount, no cross-node read/write —
  // those are covered by the next test and by doc-collab.spec.ts.
  // First in file so it runs first; a failure here means everything
  // downstream is moot.
  test('SMOKE: node-2 joins Open subgroup via inheritance + lands in folder view', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Smoke WS');
    await alice.createFolder({ name: 'OpenSpace', visibility: 'Open' });

    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    // node-2: accept invite → namespace member.
    await bob.joinNamespace(inviteUrl);

    // node-2 sees the Open folder (namespace-scope metadata reached
    // Bob's node via the gossip layer; depends on the publisher-
    // ordering fix in useFolderOperations.create).
    await bob.tree.expectFolderVisible('OpenSpace', { timeout: 60_000 });

    // node-2 opens the folder → sees Join CTA (Open chain
    // recognised) → one click → join_subgroup_inheritance (#2360)
    // materialises membership + delivers the subgroup key.
    await bob.tree.openFolder('OpenSpace');
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.clickJoin();

    // Final assertion: RestrictedFolderCard has unmounted in favour
    // of the real folder view. The DocumentList header ("Documents")
    // is the simplest signal that useFolderPermissions resolved Bob
    // as a member.
    await expect(
      bob.page.getByRole('heading', { name: /^OpenSpace$/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      bob.page.getByText(/^Documents$/),
    ).toBeVisible({ timeout: 30_000 });
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
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.clickJoin();

    await bob.docs.expectDocVisible('Alpha');

    await bob.createDoc('Beta');
    await alice.docs.expectDocVisible('Beta', { timeout: 60_000 });
  });

  test('Join folder hits /join-via-inheritance (wire-shape guard)', async ({
    alice,
    bob,
  }) => {
    // Regression guard against silently reverting to the pre-#2360
    // `listGroupContexts` + `joinContext` workaround. Intercepts
    // Bob's admin-API traffic during the Join CTA click and asserts:
    //   - POST /admin-api/groups/:id/join-via-inheritance fires
    //   - GET  /admin-api/groups/:id/contexts does NOT
    //
    // Same plumbing as the main test up to the click; we just install
    // the route interceptors on Bob's page first.
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Wire');
    await alice.createFolder({ name: 'Wire', visibility: 'Open' });
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Wire', { timeout: 60_000 });

    let calledJoinInheritance = false;
    let calledListContexts = false;
    await bob.page.route(
      '**/admin-api/groups/*/join-via-inheritance',
      async (route) => {
        calledJoinInheritance = true;
        await route.continue();
      },
    );
    await bob.page.route('**/admin-api/groups/*/contexts', async (route) => {
      // The endpoint shape is GET (list) — distinguish from POSTs to
      // unrelated /groups/:id/* paths by checking method.
      if (route.request().method() === 'GET') calledListContexts = true;
      await route.continue();
    });

    await bob.tree.openFolder('Wire');
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.clickJoin();

    expect(calledJoinInheritance).toBe(true);
    expect(calledListContexts).toBe(false);
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

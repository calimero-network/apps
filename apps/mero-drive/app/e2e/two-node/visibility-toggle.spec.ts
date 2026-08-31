// Visibility toggle propagation — tests 33-36 from the design
// catalog. Test 36 (wire-shape lowercase guard) is single-node and
// already active; tests 33-35 need a two-node setup to verify Bob's
// view reacts when Alice flips the bit.

import { test, expect } from '../fixtures/two-user';

test.describe('Visibility toggle (two-node)', () => {
  test("Open → Restricted revokes Bob's inherited access", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Flip Open->Restricted');
    await alice.createFolder({ name: 'Mutable', visibility: 'Open' });
    await alice.tree.openFolder('Mutable');
    await alice.createDoc('Visible Doc');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    // Bob: join, materialize Open membership, confirm doc access.
    await bob.joinNamespace(inviteUrl);
    await bob.tree.expectFolderVisible('Mutable', { timeout: 60_000 });
    await bob.tree.openFolder('Mutable');
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.clickJoin();
    await bob.docs.expectDocVisible('Visible Doc');

    // Alice: flip to Restricted.
    await alice.toggleVisibility('Mutable');

    // Bob: his view should collapse back to the ask-admin card once
    // the visibility op reaches his node. Generous timeout —
    // governance propagation + permission re-evaluation latency.
    await bob.restrictedCard.expectAskAdmin({ timeout: 60_000 });
  });

  test('Restricted → Open lets Bob inherit and join', async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Flip Restricted->Open');
    await alice.createFolder({ name: 'Liberating', visibility: 'Restricted' });
    await alice.tree.openFolder('Liberating');
    await alice.createDoc('Future Public');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Liberating');
    await bob.restrictedCard.expectAskAdmin();

    // Alice flips to Open.
    await alice.toggleVisibility('Liberating');

    // Bob's card swaps to the Join CTA; one click materializes
    // membership via inheritance.
    await bob.restrictedCard.expectJoinCTA({ timeout: 60_000 });
    await bob.restrictedCard.clickJoin();
    await bob.docs.expectDocVisible('Future Public');
  });

  test('set_subgroup_visibility wire payload is lowercase', async ({
    alice,
  }) => {
    // Wire-shape regression guard — single-node, intercepts the
    // admin-api request and asserts the payload's
    // `subgroupVisibility` is lowercase. Core's handler returns 400
    // on capitalized values (set_subgroup_visibility.rs:31).
    await alice.goToWorkspace();
    await alice.createNamespace(`Wire WS ${Date.now()}`);
    await alice.createFolder({ name: 'WireFolder', visibility: 'Open' });

    let payload: Record<string, unknown> | null = null;
    await alice.page.route(
      '**/admin-api/groups/*/settings/subgroup-visibility',
      async (route) => {
        const body = route.request().postData();
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch {
            /* fall through — assertion below catches it */
          }
        }
        await route.continue();
      },
    );

    await alice.toggleVisibility('WireFolder');

    expect(payload).not.toBeNull();
    expect(typeof payload!.subgroupVisibility).toBe('string');
    expect(payload!.subgroupVisibility).toMatch(/^(open|restricted)$/);
  });
});

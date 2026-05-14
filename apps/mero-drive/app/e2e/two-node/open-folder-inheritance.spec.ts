// Marquee two-node test: Open-subgroup inheritance materialization.
//
// The single most-broken regression-prone path in mero-drive — this
// is what core PRs #2261, #2338, #2344, and #2351 collectively make
// work end-to-end. Failure here means: Bob's node joins the
// namespace, never gets the visibility op, can't materialize
// membership via inheritance, can't read Alice's docs, can't write
// his own.
//
// Tests 27-29 from the design catalog.

import { test, expect } from '../fixtures/two-user';

test.describe('Open folder inheritance (two-node)', () => {
  test('Bob inherits Alice\'s Open folder created before he joined', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Phoenix Pre');
    await alice.createFolder({
      name: 'Specs',
      visibility: 'Open',
    });
    await alice.tree.openFolder('Specs');
    await alice.createDoc('Alpha');

    // Bob joins via invitation. Implementation detail: invite
    // delivery is out-of-band — we read Alice's invite from her
    // settings panel and hand the URL to Bob.
    const inviteUrl = await alice.settings
      // TODO(driver): once SettingsDriver exposes copyNamespaceInvite,
      // replace this placeholder. For now the test is expected to
      // skip on real env until that helper lands.
      .copyNamespaceInvite?.();
    test.skip(
      !inviteUrl,
      'Driver does not yet expose namespace-invite copy; ' +
        'implement SettingsDriver.copyNamespaceInvite once the ' +
        'InviteDialog locator is stable.',
    );

    await bob.page.goto(inviteUrl!);
    await bob.page.getByRole('button', { name: /Accept & join/i }).click();
    await expect(bob.page).toHaveURL(/\/app/, { timeout: 30_000 });

    // Bob sees the folder in his tree (eventually — name comes from
    // namespace-scope metadata propagation; today this depends on
    // core #2358 for Open subgroups).
    await bob.tree.expectFolderVisible('Specs', { timeout: 60_000 });

    // Bob clicks the folder → restricted card → Join CTA.
    await bob.tree.openFolder('Specs');
    await bob.restrictedCard.expectJoinCTA();
    await bob.restrictedCard.clickJoin();

    // Inheritance materialization done; Bob sees Alice's doc.
    await bob.docs.expectDocVisible('Alpha');

    // Bob writes his own; Alice sees it.
    await bob.createDoc('Beta');
    await alice.docs.expectDocVisible('Beta', { timeout: 60_000 });
  });

  test.skip(
    'Open folder created AFTER Bob joined appears on Bob without manual refresh',
    async ({ alice, bob }) => {
      // Same flow as above but: invite Bob first, then create the
      // folder. Asserts Bob's tree refreshes via subscription rather
      // than poll. Skipped until namespace-invite driver lands.
    },
  );

  test.skip(
    'RestrictedFolderCard shows syncing pre-visibility-op; swaps to Join CTA',
    async ({ alice, bob }) => {
      // Race: open the card view before the visibility op has
      // reached Bob's node. Card should show "Workspace is still
      // syncing" → "Try joining"; once the op arrives the heading
      // swaps to "Join this open folder" / "Join folder".
    },
  );
});

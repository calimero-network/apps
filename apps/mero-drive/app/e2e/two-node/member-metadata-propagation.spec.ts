// Member display name propagation — tests 40-42 from the catalog.
//
// Namespace member metadata propagates via the namespace root group's
// own metadata records (#2338). All namespace members have the
// namespace key, so this is straightforward propagation — not subject
// to the subgroup-encryption ordering trap that folder names are.

import { test, expect } from '../fixtures/two-user';

test.describe('Member metadata propagation (two-node)', () => {
  test("Alice's namespace display name visible to Bob", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Alice Name WS');
    await alice.setMyDisplayName('Alice Astra');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    // Bob's settings panel should surface the namespace member list.
    // For the MVP signal we just check the name appears somewhere in
    // Bob's settings view.
    await bob.openSettings();
    await expect(
      bob.page.getByText('Alice Astra', { exact: false }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("Bob's display name visible to Alice", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Bob Name WS');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.setMyDisplayName('Bob Beta');

    await alice.openSettings();
    await expect(
      alice.page.getByText('Bob Beta', { exact: false }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test.skip(
    'Display name reflects in document author/owner',
    async ({ alice, bob }) => {
      // Doc-level authorship metadata isn't surfaced in the current
      // DocumentList row UI, so there's no obvious place to assert
      // the name resolution. Re-enable when DocumentList shows
      // owner labels.
      void alice;
      void bob;
    },
  );
});

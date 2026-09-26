// Member display name propagation — tests 40-42 from the catalog.
//
// Namespace member metadata propagates via the namespace root group's
// own metadata records (#2338). All namespace members have the
// namespace key, so this is straightforward propagation — not subject
// to the subgroup-encryption ordering trap that folder names are.

import { test, expect } from '../fixtures/two-user';

const NAME_ARRIVES_MS = 30_000; // a few of core's 10 s interval syncs, well short of a reload

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

  test("A name Bob sets after joining reaches Alice's open members list", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Live Members WS');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();

    await bob.joinNamespaceKeepGate(inviteUrl);
    const members = alice.page
      .getByRole('region', { name: 'Namespace members' })
      .getByRole('listitem');
    await expect(members).toHaveCount(2, { timeout: 60_000 });

    await bob.dismissNameGate('Bob Beta');
    await expect(members.filter({ hasText: 'Bob Beta' })).toHaveCount(1, {
      timeout: NAME_ARRIVES_MS,
    });
  });

  test("A name Bob sets mid-edit reaches Alice's editor", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Live Caret WS');
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
    await alice.editor.type('hi');
    await bob.editor.type('yo');
    const peersOf = (p: typeof alice.page) =>
      p.getByRole('group', { name: /^Also here:/ });
    await expect(peersOf(alice.page)).toHaveAttribute(
      'aria-label',
      'Also here: bob',
      { timeout: 60_000 },
    );

    // Settings shares <main> with the editor, so closing it reopens the doc.
    await bob.setMyDisplayName('Bob Beta');
    await bob.editor.type('!');
    await expect(peersOf(alice.page)).toHaveAttribute(
      'aria-label',
      'Also here: Bob Beta',
      { timeout: NAME_ARRIVES_MS },
    );
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

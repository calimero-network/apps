// Home is live: a peer's new doc and a peer's presence reach it without a
// reload, and its counts never include a folder the viewer cannot open.

import { test, expect } from '../fixtures/two-user';

test.describe('Home live (two-node)', () => {
  test("Bob's new doc appears on Alice's Home", async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Home Live WS');
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('From Alice');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();
    await alice.home.open();
    await alice.home.expectTitles(['From Alice']);

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted('Shared');
    await bob.createDoc('From Bob');

    await expect(alice.home.row('From Bob')).toBeVisible({ timeout: 60_000 });
    await expect(alice.home.row('From Bob')).toContainText('Shared');
  });

  test('"bob is here" shows on the row while Bob has it open, then clears', async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Home Presence WS');
    await alice.createFolder({ name: 'Room', visibility: 'Open' });
    await alice.tree.openFolder('Room');
    await alice.createDoc('Together');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();
    await alice.home.open();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Room');
    await bob.restrictedCard.joinIfPrompted('Room');
    await bob.openDoc('Together');

    const row = alice.home.row('Together');
    await expect(row.getByText('bob is here')).toBeVisible({ timeout: 60_000 });

    // Leaving the doc sends a leave, so the pill goes well inside the node's replay window.
    await bob.editor.close();
    await expect(row.getByText('bob is here')).toBeHidden({ timeout: 25_000 });
  });

  test("Bob's counts leave out a restricted folder he is not in", async ({
    alice,
    bob,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace('Home Counts WS');
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Plan');
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Budget');
    await alice.home.open();
    await alice.home.expectTitles(['Budget', 'Plan']);
    await expect(alice.home.navRow()).toHaveAccessibleName('Home, 2');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.home.open();
    await bob.home.expectTitles(['Plan'], { timeout: 60_000 });
    await expect(bob.home.navRow()).toHaveAccessibleName('Home, 1');
    await expect(
      bob.page.getByText('1 document across 1 folder'),
    ).toBeVisible();
    await expect(bob.home.row('Budget')).toHaveCount(0);
  });
});

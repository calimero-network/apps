// Details across nodes: a peer's new link shows in Linked from, a link from a
// doc Bob cannot open never shows for him, and a peer's edit names them.

import { test, expect } from '../fixtures/two-user';

const SYNC_MS = 60_000; // one sync round between nodes, with room

test.describe('Details across nodes (two-node)', () => {
  let planUrl = '';

  test.beforeEach(async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Backlinks WS ${Date.now()}`);
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Notes');
    await alice.createDoc('Plan');
    await alice.openDoc('Plan');
    planUrl = alice.page.url();
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted('Shared');
    await bob.docs.expectDocVisible('Plan');
    await alice.details.open();
  });

  test("Bob's new link to Plan appears in Alice's Linked from (L-24)", async ({
    alice,
    bob,
  }) => {
    await bob.openDoc('Notes');
    await bob.editor.type('Read ');
    await bob.editor.pasteLink(planUrl, 'Plan');
    await bob.page.keyboard.type(' first.');

    const from = alice.details.section('Linked from');
    await expect(from.getByRole('button', { name: /Notes/ })).toBeVisible({
      timeout: SYNC_MS,
    });
    await expect(from.locator('b')).toHaveText('Plan');
  });

  test('a link from a doc Bob cannot open never shows for him (L-25)', async ({
    alice,
    bob,
  }) => {
    await alice.editor.close();
    await alice.createFolder({ name: 'Private', visibility: 'Restricted' });
    await alice.tree.openFolder('Private');
    await alice.createDoc('Secret');
    await alice.openDoc('Secret');
    await alice.editor.type('See ');
    await alice.editor.pasteLink(planUrl, 'Plan');
    // Secret's Links to reads the node, so the link is saved before the reload drops the page.
    await alice.details.open();
    await expect(
      alice.details.section('Links to').getByRole('button', { name: /Plan/ }),
    ).toBeVisible({ timeout: SYNC_MS });
    await alice.page.goto(planUrl);
    await alice.editor.expectMounted();
    await expect(
      alice.details.section('Linked from').getByRole('button', { name: /Secret/ }),
    ).toBeVisible({ timeout: SYNC_MS });

    await bob.page.goto(planUrl);
    await bob.editor.expectMounted({ timeout: SYNC_MS });
    await bob.details.open();
    await expect(bob.details.panel()).toContainText(
      'Only documents you can open are listed',
    );
    await expect(bob.details.section('Linked from')).toContainText(
      'No documents link here yet',
    );
    await expect(bob.details.panel()).not.toContainText('Secret');
  });

  test("Bob's edit shows as Updated by Bob on Alice's Details (L-26)", async ({
    alice,
    bob,
  }) => {
    await expect(alice.details.fact('Updated')).toHaveText(/ by You$/);

    await bob.openDoc('Plan');
    await bob.editor.type('Edited by Bob');

    await expect(alice.details.fact('Updated')).toHaveText(/ by bob$/, {
      timeout: SYNC_MS,
    });
    await expect(alice.details.fact('Created')).toHaveText(/ by You$/);
  });
});

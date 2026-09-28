// Tags converge across nodes: two members tagging one doc at once both hold,
// and a rename or recolour on one node reaches the other's open doc live.

import { test, expect } from '../fixtures/two-user';

const RED = 'rgb(239, 68, 68)';

test.describe('Tags across nodes (two-node)', () => {
  test.beforeEach(async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Tags Sync WS ${Date.now()}`);
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Plan');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted('Shared');
    await bob.docs.expectDocVisible('Plan');

    await alice.openDoc('Plan');
    await bob.openDoc('Plan');
  });

  test("both members' tags hold, and each appears on the other's open doc", async ({
    alice,
    bob,
  }) => {
    await Promise.all([alice.tags.create('alpha'), bob.tags.create('beta')]);

    for (const driver of [alice, bob]) {
      await expect(driver.tags.chip('alpha')).toBeVisible({ timeout: 60_000 });
      await expect(driver.tags.chip('beta')).toBeVisible({ timeout: 60_000 });
    }
  });

  test("a rename and a recolour on Alice's tag page reach Bob's open doc", async ({
    alice,
    bob,
  }) => {
    await alice.tags.create('draft');
    await expect(bob.tags.chip('draft')).toBeVisible({ timeout: 60_000 });

    const { page, home } = alice;
    await home.tagRow('draft').click();
    await expect(home.heading()).toHaveText('draft');
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Rename' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Rename tag' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('final');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(home.heading()).toHaveText('final');
    await expect(bob.tags.chip('final')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('main').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Colour' }).click();
    await page.getByRole('menuitemradio', { name: 'Red' }).click();
    await expect
      .poll(() => bob.tags.dotColour('final'), { timeout: 60_000 })
      .toBe(RED);
  });
});

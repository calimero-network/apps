// Shared views live in the registry, so Bob sees Alice's shared view without
// refreshing; a personal view never leaves the device that saved it.

import { test, expect } from '../fixtures/two-user';

const NO_SYNC_HOLD_MS = 10_000; // long enough for a registry event to have landed if one were coming

test.describe('Shared views across nodes (two-node)', () => {
  test.beforeEach(async ({ alice, bob }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Shared Views WS ${Date.now()}`);
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Plan');
    await alice.openDoc('Plan');
    await alice.tags.create('design');
    await alice.openSettings();
    const inviteUrl = await alice.settings.copyNamespaceInvite();
    await alice.closeSettings();

    await bob.joinNamespace(inviteUrl);
    await bob.tree.openFolder('Shared');
    await bob.restrictedCard.joinIfPrompted('Shared');
    await bob.docs.expectDocVisible('Plan');

    await alice.home.open();
    await bob.home.open();
  });

  test("Bob sees Alice's shared view live under Views (R-21)", async ({
    alice,
    bob,
  }) => {
    const { page, home } = alice;
    await home.chip('Tag').click();
    await page.getByRole('checkbox', { name: /^design/ }).click();
    await page.keyboard.press('Escape');

    await home.saveViewButton().click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Design docs');
    await page.getByRole('radio', { name: /Everyone in/ }).click();
    await page
      .locator('form')
      .getByRole('button', { name: 'Save view' })
      .click();
    await expect(home.viewRow('Design docs')).toBeVisible();

    await expect(bob.home.viewRow('Design docs')).toBeVisible({
      timeout: 30_000,
    });
    await expect(bob.home.viewRow('Design docs')).toHaveAccessibleName(
      'Design docs, shared with everyone, 1',
    );

    await bob.home.viewRow('Design docs').click();
    await expect(bob.home.heading()).toHaveText('Home');
    await bob.home.expectTitles(['Plan']);
  });

  test("a personal view stays on Alice's device only", async ({
    alice,
    bob,
  }) => {
    const { page, home } = alice;
    await home.chip('Tag').click();
    await page.getByRole('checkbox', { name: /^design/ }).click();
    await page.keyboard.press('Escape');

    await home.saveViewButton().click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Mine only');
    await page
      .locator('form')
      .getByRole('button', { name: 'Save view' })
      .click();
    await expect(home.viewRow('Mine only')).toBeVisible();

    await bob.page.waitForTimeout(NO_SYNC_HOLD_MS);
    await expect(bob.home.viewRow('Mine only')).toHaveCount(0);
  });
});

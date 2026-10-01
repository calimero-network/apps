// Saved views: a filtered Home list pinned under Views, personal to this
// device unless shared, and how it behaves once what it filtered on is gone.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/single-user';

function searchOf(page: Page): string {
  return new URL(page.url()).search;
}

// The submit button inside the popover shares its label with the trigger
// that opens it, so it is found within the form, not by name alone.
function saveSubmit(page: Page) {
  return page.locator('form').getByRole('button', { name: 'Save view' });
}

test.describe('Saved views (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Views WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Roadmap');
    await alice.openDoc('Roadmap');
    await alice.tags.create('design');
    await alice.home.open();
  });

  test('a personal view is saved on this device, listed under Views, and survives a reload (R-20)', async ({
    alice,
  }) => {
    const { page, home } = alice;
    await home.chip('Tag').click();
    await page.getByRole('checkbox', { name: /^design/ }).click();
    await page.keyboard.press('Escape');

    await home.saveViewButton().click();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'design',
    );
    await expect(page.getByRole('radio', { name: /Only me/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await saveSubmit(page).click();

    await expect(page.getByRole('textbox', { name: 'Name' })).toBeHidden();
    await expect.poll(() => searchOf(page)).toContain('view=');
    await expect(home.viewRow('design')).toHaveAccessibleName('design, 1');

    await page.reload();
    await home.open();
    await expect(home.viewRow('design')).toHaveAccessibleName('design, 1');
  });

  test('renames, copies a link to and deletes a view from its menu (R-22)', async ({
    alice,
  }) => {
    const { page, home } = alice;
    await home.chip('Tag').click();
    await page.getByRole('checkbox', { name: /^design/ }).click();
    await page.keyboard.press('Escape');
    await home.saveViewButton().click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Design docs');
    await saveSubmit(page).click();
    await expect(home.viewRow('Design docs')).toBeVisible();

    await home.viewMenuButton('Design docs').click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename view' });
    await renameDialog
      .getByRole('textbox', { name: 'Name' })
      .fill('Design this week');
    await renameDialog.getByRole('button', { name: 'Save' }).click();
    await expect(renameDialog).toBeHidden();
    await expect(home.viewRow('Design this week')).toBeVisible();

    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await home.viewMenuButton('Design this week').click();
    await page.getByRole('menuitem', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('/app/');
    expect(copied).toContain('view=');

    await home.viewMenuButton('Design this week').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Delete view?' });
    await confirmDialog.getByRole('button', { name: 'Delete view' }).click();
    await expect(home.viewRow('Design this week')).toHaveCount(0);
  });

  test('a view whose tag is later deleted opens with Unknown, no crash (R-23)', async ({
    alice,
  }) => {
    const { page, home } = alice;
    await home.chip('Tag').click();
    await page.getByRole('checkbox', { name: /^design/ }).click();
    await page.keyboard.press('Escape');
    await home.saveViewButton().click();
    await saveSubmit(page).click();
    await expect(home.viewRow('design')).toBeVisible();

    await home.tagRow('design').click();
    await page.getByRole('main').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Delete tag' }).click();
    await page
      .getByRole('dialog', { name: 'Delete tag?' })
      .getByRole('button', { name: 'Delete tag' })
      .click();
    await expect(home.heading()).toHaveText('Home', { timeout: 15_000 });

    await home.viewRow('design').click();
    await expect(home.chip('Unknown tag')).toBeVisible();
    await expect(home.heading()).toHaveText('Home');
  });

  test('two views saved from the same filters highlight by id, not by filter (R-24)', async ({
    alice,
  }) => {
    const { page, home } = alice;
    await home.chip('Tag').click();
    await page.getByRole('checkbox', { name: /^design/ }).click();
    await page.keyboard.press('Escape');

    await home.saveViewButton().click();
    await page.getByRole('textbox', { name: 'Name' }).fill('First');
    await saveSubmit(page).click();
    await expect(home.viewRow('First')).toBeVisible();

    await home.saveViewButton().click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Second');
    await saveSubmit(page).click();
    await expect(home.viewRow('Second')).toBeVisible();

    await home.viewRow('First').click();
    await expect(home.viewRow('First')).toHaveAttribute('aria-current', 'page');
    await expect(home.viewRow('Second')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    await home.viewRow('Second').click();
    await expect(home.viewRow('Second')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(home.viewRow('First')).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

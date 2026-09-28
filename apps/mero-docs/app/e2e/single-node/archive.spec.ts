// Archive and Unarchive from the document menu: the doc stays open under a
// banner, leaves Home and search, and the Archived chip brings it back.

import { test, expect } from '../fixtures/single-user';

const BANNER = 'This document is archived';

test.describe('Archive (single-node)', () => {
  test('archives a doc out of Home and search, then unarchives it (R-25, S-21)', async ({
    alice,
  }) => {
    const { page, editor, home } = alice;
    await alice.goToWorkspace();
    await alice.createNamespace(`Archive WS ${Date.now()}`);
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Current plan');
    await alice.createDoc('Old plan');

    await alice.openDoc('Old plan');
    await page.getByRole('button', { name: 'Document actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    const banner = page.getByRole('group', { name: BANNER });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('doc-title-input')).toHaveValue('Old plan');
    const docUrl = page.url();

    await home.open();
    await home.expectTitles(['Current plan']);
    await home.chip('Archived').click();
    await home.expectTitles(['Old plan']);

    await alice.palette.search('plan');
    const palette = alice.palette.dialog();
    await expect(
      palette.getByRole('option', { name: /Current plan/ }).first(),
    ).toBeVisible();
    await expect(palette.getByRole('option', { name: /Old plan/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto(docUrl);
    await editor.expectMounted();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await banner.getByRole('button', { name: 'Unarchive' }).click();
    await expect(banner).toBeHidden({ timeout: 15_000 });

    await home.open();
    await home.expectTitles(['Old plan', 'Current plan']);
  });
});

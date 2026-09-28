// Settings and sharing surface - tests 24-26.

import { test, expect } from '../fixtures/single-user';

test.describe('Settings + sharing (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Settings WS ${Date.now()}`);
  });

  test('FolderSharingPanel renders member list for Restricted folder', async ({
    alice,
  }) => {
    // Sharing controls now live inside the Info modal (⋯ → Info).
    await alice.createFolder({
      name: 'Restricted Sharing',
      visibility: 'Restricted',
    });
    await alice.openFolderInfo('Restricted Sharing');
    await expect(
      alice.page.getByRole('heading', { name: /^Members$/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      alice.page.getByPlaceholder(/member ID/i),
    ).toBeVisible();
    await alice.closeFolderInfo();
  });

  test('Visibility toggle available in Info panel', async ({ alice }) => {
    // The visibility toggle is now a button inside the Info modal,
    // not a dropdown menuitem.
    await alice.createFolder({ name: 'Toggleable', visibility: 'Open' });
    await alice.openFolderInfo('Toggleable');
    await expect(
      alice.page
        .getByRole('dialog')
        .getByRole('button', { name: /Make restricted/i }),
    ).toBeVisible({ timeout: 30_000 });
    await alice.closeFolderInfo();
  });

  test('Visibility toggle shows exactly one option per state', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Settled', visibility: 'Open' });
    await alice.openFolderInfo('Settled');
    const dialog = alice.page.getByRole('dialog');
    // For an Open folder we expect "Make restricted" (and only it). The toggle
    // waits on a permission fetch, so wait for it before counting.
    await expect(
      dialog.getByRole('button', { name: /Make restricted/i }),
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(dialog.getByRole('button', { name: /Make open/i })).toHaveCount(0);
    await alice.closeFolderInfo();
  });

  test('Cancelling Make restricted leaves the folder open', async ({ alice }) => {
    await alice.createFolder({ name: 'Stays Open', visibility: 'Open' });
    await alice.openFolderInfo('Stays Open');
    const info = alice.page.getByRole('dialog', { name: 'Stays Open' });
    await info
      .getByRole('button', { name: /Make restricted/i })
      .click({ timeout: 30_000 });
    const confirm = alice.page.getByRole('dialog', {
      name: 'Make this folder restricted?',
    });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(info.getByRole('button', { name: /Make restricted/i })).toBeVisible();
    await alice.closeFolderInfo();
  });

  test('Each workspace member row has one role control', async ({ alice }) => {
    await alice.openSettings();
    const members = alice.page.getByRole('region', { name: 'Workspace members' });
    const row = members.getByRole('listitem').first();
    await expect(row.getByRole('combobox')).toHaveCount(1, { timeout: 30_000 });
    // The creator is the only admin, and nobody may change their own role.
    await expect(row.getByRole('combobox')).toHaveValue('Admin');
    await alice.closeSettings();
  });
});

// Settings and sharing surface — tests 24-26.

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
      alice.page.getByPlaceholder(/identity pubkey/i),
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
    const restrictCount = await alice.page
      .getByRole('dialog')
      .getByRole('button', { name: /Make restricted/i })
      .count();
    const openCount = await alice.page
      .getByRole('dialog')
      .getByRole('button', { name: /Make open/i })
      .count();
    // For an Open folder we expect "Make restricted" (and only it).
    expect(restrictCount + openCount).toBe(1);
    expect(restrictCount).toBe(1);
    await alice.closeFolderInfo();
  });
});

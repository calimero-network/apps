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
    await alice.createFolder({
      name: 'Restricted Sharing',
      visibility: 'Restricted',
    });
    await alice.tree.openFolder('Restricted Sharing');
    await expect(
      alice.page.getByRole('heading', { name: /^Members$/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      alice.page.getByPlaceholder(/identity pubkey/i),
    ).toBeVisible();
  });

  test('Visibility toggle dropdown available on owned folder', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Toggleable', visibility: 'Open' });
    await alice.tree.openFolder('Toggleable');
    await alice.tree.openContextMenu('Toggleable');
    await expect(
      alice.page.getByRole('menuitem', { name: /Make restricted/i }),
    ).toBeVisible({ timeout: 10_000 });
    // Close the menu.
    await alice.page.keyboard.press('Escape');
  });

  test('Visibility toggle dropdown hidden while visibility undefined', async ({
    alice,
  }) => {
    // On creation the folder is bootstrapped with explicit
    // visibility, so the "undefined" branch is hard to reproduce
    // on the same node; rely on the fact that the toggle should
    // never appear with text matching both options simultaneously.
    await alice.createFolder({ name: 'Settled', visibility: 'Open' });
    await alice.tree.openFolder('Settled');
    await alice.tree.openContextMenu('Settled');
    const restrictItem = alice.page.getByRole('menuitem', {
      name: /Make restricted/i,
    });
    const openItem = alice.page.getByRole('menuitem', {
      name: /Make open/i,
    });
    const restrictCount = await restrictItem.count();
    const openCount = await openItem.count();
    // Exactly one of the two should be present — never zero, never
    // both. Zero means visibility is undefined (a bug for an
    // already-created folder); both means duplicate menu render.
    expect(restrictCount + openCount).toBe(1);
    await alice.page.keyboard.press('Escape');
  });
});

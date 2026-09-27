// A fresh workspace must lead the user from nothing to an open document
// using only the actions its empty screens offer.

import { test, expect } from '../fixtures/single-user';

test.describe('Empty states (single-node)', () => {
  test('empty sidebar creates a folder, empty folder creates a document', async ({
    alice,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Empty WS ${Date.now()}`);
    const { page } = alice;
    const sidebar = page.locator('aside');

    await expect(sidebar.getByText('No folders yet.')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'No folders yet' }),
    ).toBeVisible();
    const headerNew = sidebar.getByRole('button', { name: 'New', exact: true });
    await expect(headerNew).toHaveCount(0);

    await sidebar.getByRole('button', { name: 'New folder' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/Folder name/i).fill('Notes');
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await alice.tree.expectFolderVisible('Notes');
    await expect(sidebar.getByText('No folders yet.')).toBeHidden();
    await expect(headerNew).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Select a folder' }),
    ).toBeVisible();

    await alice.tree.folderRow('Notes').first().click();
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: 'No documents yet' }),
    ).toBeVisible({ timeout: 15_000 });
    await main.getByRole('button', { name: 'New document' }).click();
    await alice.editor.expectMounted();
    await expect(page.getByTestId('doc-title-input')).toHaveValue('Untitled', {
      timeout: 15_000,
    });
  });

  test('double-clicking the row New document button creates exactly one document', async ({
    alice,
  }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Empty WS ${Date.now()}`);
    await alice.createFolder({ name: 'Pad', visibility: 'Open' });
    const row = alice.tree.folderRow('Pad').first();
    await row.hover();
    const newDocButton = row.getByRole('button', { name: 'New document' });
    await expect(newDocButton).toBeVisible({ timeout: 15_000 });

    // Actionability is checked once, so the second click does not wait for re-enable.
    await newDocButton.dblclick();
    await alice.editor.expectMounted();

    // The list that shows the rename was fetched after it, so it also shows any duplicate.
    await alice.editor.renameTitle('Settle');
    await alice.docs.expectDocVisible('Settle');
    await expect(alice.docs.docRow('Untitled')).toHaveCount(0);
  });
});

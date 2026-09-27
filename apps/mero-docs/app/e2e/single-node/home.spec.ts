// Home is the workspace's landing screen: every doc the member can read,
// newest first, and the way to a first folder or document.

import { test, expect } from '../fixtures/single-user';

test.describe('Home (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Home WS ${Date.now()}`);
  });

  test('offers a first folder, then a first document', async ({ alice }) => {
    const main = alice.page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: 'No folders yet' }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await main.getByRole('button', { name: 'New folder' }).click();
    const dialog = alice.page.getByRole('dialog', { name: 'New folder' });
    await dialog.getByPlaceholder(/Folder name/i).fill('Notes');
    await dialog.getByRole('button', { name: /^Create$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await expect(
      main.getByRole('heading', { name: 'No documents yet' }),
    ).toBeVisible({
      timeout: 30_000,
    });
    // One writable folder: New document opens a doc there, with no picker.
    await main.getByRole('button', { name: 'New document' }).click();
    await alice.editor.expectMounted();
    await expect(
      alice.page.getByRole('dialog', { name: /New document in/ }),
    ).toHaveCount(0);
    expect(new URL(alice.page.url()).pathname).toMatch(/\/f\/[^/]+\/d\/[^/]+$/);
  });

  test('lists every doc across folders, newest first, with its folder', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Roadmap');
    await alice.createFolder({
      name: 'Specs',
      parent: 'Product',
      visibility: 'Open',
    });
    await alice.tree.openFolder('Specs');
    await alice.createDoc('API spec');
    await alice.createFolder({ name: 'Design', visibility: 'Open' });
    await alice.tree.openFolder('Design');
    await alice.createDoc('Brand');

    await alice.home.open();
    await alice.home.expectTitles(['Brand', 'API spec', 'Roadmap']);
    await expect(
      alice.page.getByText('3 documents across 3 folders'),
    ).toBeVisible();
    await expect(alice.home.row('API spec')).toContainText('Product / Specs');
    await expect(alice.home.row('Brand')).toContainText('Just now');
    await expect(alice.home.navRow()).toHaveAccessibleName('Home, 3');

    await alice.home.row('Roadmap').click();
    await alice.editor.expectMounted();
    await expect(alice.page.getByTestId('doc-title-input')).toHaveValue(
      'Roadmap',
      {
        timeout: 15_000,
      },
    );
  });

  test('asks which folder a new document goes in when there are several', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.createFolder({ name: 'Design', visibility: 'Open' });
    await alice.tree.openFolder('Design');
    await alice.createDoc('Brand');
    await alice.home.open();

    await alice.page
      .getByRole('main')
      .getByRole('button', { name: 'New document' })
      .click();
    const picker = alice.page.getByRole('dialog', { name: 'New document in…' });
    await expect(picker.getByRole('button')).toHaveText(['Design', 'Product']);
    await picker.getByRole('button', { name: 'Product' }).click();
    await alice.editor.expectMounted();
    await alice.editor.renameTitle('Launch');
    await alice.home.open();
    await expect(alice.home.row('Launch')).toContainText('Product', {
      timeout: 30_000,
    });
  });

  test('a folder route is the same list for that folder, under its name', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Product', visibility: 'Open' });
    await alice.tree.openFolder('Product');
    await alice.createDoc('Roadmap');
    await alice.createFolder({ name: 'Design', visibility: 'Open' });
    await alice.tree.openFolder('Design');
    await alice.createDoc('Brand');

    await alice.tree.folderRow('Product').first().click();
    const main = alice.page.getByRole('main');
    await expect(
      main.getByRole('heading', { level: 1, name: 'Product' }),
    ).toBeVisible();
    await alice.home.expectTitles(['Roadmap']);
  });
});

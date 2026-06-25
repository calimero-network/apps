// Folder CRUD — tests 10-17 from the design catalog.

import { test, expect } from '../fixtures/single-user';

test.describe('Folder CRUD (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Folder WS ${Date.now()}`);
  });

  test('create Open folder appears in tree', async ({ alice }) => {
    await alice.createFolder({ name: 'Open A', visibility: 'Open' });
    await alice.tree.expectFolderVisible('Open A');
  });

  test('create Restricted folder is visible to its creator', async ({
    alice,
  }) => {
    // Note: mero-drive doesn't render a row-level visibility indicator
    // (no lock icon on the FolderTree row). Restricted is a *state*
    // surfaced when a non-member opens the folder via
    // RestrictedFolderCard, not a per-row glyph. So this test just
    // asserts the creator can create + see a Restricted folder; the
    // distinction-by-state is covered in the two-node
    // restricted-folder-invite spec.
    await alice.createFolder({ name: 'Restricted A', visibility: 'Restricted' });
    await alice.tree.expectFolderVisible('Restricted A');
  });

  test('rename folder updates tree', async ({ alice }) => {
    await alice.createFolder({ name: 'Specs', visibility: 'Open' });
    await alice.renameFolder('Specs', 'Documents');
    await alice.tree.expectFolderHidden('Specs');
    await alice.tree.expectFolderVisible('Documents');
  });

  test.skip('reparent folder shifts ancestry', async ({ alice }) => {
    // Drag-reparent UI not yet covered by the driver — needs an
    // explicit menuitem or drag-handle locator. Tracked separately.
  });

  test('delete folder with no children removes it from tree', async ({
    alice,
  }) => {
    await alice.createFolder({ name: 'Doomed', visibility: 'Open' });
    await alice.deleteFolder('Doomed');
    await alice.tree.expectFolderHidden('Doomed');
  });

  test.skip('delete folder with children cascades leaf-first', async ({
    alice,
  }) => {
    // Needs nested-folder creation in driver — skipped until
    // createFolder supports parent option.
  });

  test('create folder with empty alias shows validation error', async ({
    alice,
  }) => {
    // Scope to aside — the only "New" button is the FolderTree header
    // button (DocumentList's "New" is gone in the PR1 UI).
    await alice.page.locator('aside').getByRole('button', { name: /^New$/ }).click();
    const dialog = alice.page.getByRole('dialog');
    // Leave the input empty and try to submit; create button should
    // be disabled OR a validation error appears.
    const createBtn = dialog.getByRole('button', { name: /^Create$/ });
    if (await createBtn.isEnabled()) {
      await createBtn.click();
      await expect(dialog).toBeVisible(); // Still open = validation rejected.
    } else {
      expect(await createBtn.isEnabled()).toBe(false);
    }
    // Close the dialog so the next test starts clean.
    await alice.page.keyboard.press('Escape');
  });
});

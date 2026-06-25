// Document CRUD — tests 18-23 from the design catalog.

import { test, expect } from '../fixtures/single-user';

test.describe('Document CRUD (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Doc WS ${Date.now()}`);
    await alice.createFolder({ name: 'Drafts', visibility: 'Open' });
    await alice.tree.openFolder('Drafts');
  });

  test('create doc appears in the sidebar', async ({ alice }) => {
    await alice.createDoc('Hello World');
    await alice.docs.expectDocVisible('Hello World');
  });

  test('open doc mounts the inline editor', async ({ alice }) => {
    await alice.createDoc('Open Me');
    await alice.openDoc('Open Me');
    await alice.editor.expectMounted();
  });

  test('edit doc persists across editor close/open', async ({ alice }) => {
    await alice.createDoc('Persistent');
    await alice.openDoc('Persistent');
    await alice.editor.type('First content');
    await alice.editor.expectContent('First content');
    await alice.editor.close();
    await alice.openDoc('Persistent');
    await alice.editor.expectContent('First content');
  });

  test('close editor returns to folder view', async ({ alice }) => {
    await alice.createDoc('Returnable');
    await alice.openDoc('Returnable');
    await alice.editor.close();
    await alice.docs.expectDocVisible('Returnable');
    await expect(
      alice.page.getByRole('heading', { name: /No document open/i }),
    ).toBeVisible();
  });

  test('delete doc removes from list', async ({ alice }) => {
    await alice.createDoc('To Trash');
    await alice.openDoc('To Trash');
    await alice.editor.deleteDocument();
    await alice.docs.expectDocHidden('To Trash');
  });

  test('switching folders clears the open document', async ({ alice }) => {
    await alice.createDoc('Doc A');
    await alice.createFolder({ name: 'Other', visibility: 'Open' });
    await alice.tree.openFolder('Other');
    // No doc open in the new folder — editor unmounts, empty state shows.
    await expect(alice.page.locator('.ProseMirror')).toBeHidden();
    await expect(
      alice.page.getByRole('heading', { name: /No document open/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

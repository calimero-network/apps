// BlockNote editor — surface + slash menu + JSON persistence.
//
// doc-crud.spec.ts already covers generic CRUD/persist via the editor;
// this spec pins the things that are specifically BlockNote: the
// `.bn-container` surface mounts, the slash menu opens, and content
// typed into BlockNote survives a close/reopen round-trip (i.e. it
// serialized to JSON, persisted through the CRDT, and parsed back).

import { test, expect } from '../fixtures/single-user';

test.describe('BlockNote editor (single-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`BN WS ${Date.now()}`);
    await alice.createFolder({ name: 'Notes', visibility: 'Open' });
    await alice.tree.openFolder('Notes');
  });

  test('opens a BlockNote editor surface', async ({ alice }) => {
    await alice.createDoc('BN Doc');
    await alice.openDoc('BN Doc');
    await alice.editor.expectMounted();
    // `.bn-container` confirms BlockNote (not the old Tiptap shell).
    await expect(alice.page.locator('.bn-container')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('slash menu opens on "/"', async ({ alice }) => {
    await alice.createDoc('Slash');
    await alice.openDoc('Slash');
    const editor = alice.page.locator('.ProseMirror').first();
    await editor.click();
    await editor.pressSequentially('/');
    // The slash suggestion menu lists block types — "Heading" is a
    // stable default item.
    await expect(alice.page.getByText(/Heading/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('typed content persists as a BlockNote document across reload', async ({
    alice,
  }) => {
    await alice.createDoc('Persisted BN');
    await alice.openDoc('Persisted BN');
    await alice.editor.type('block note content');
    await alice.editor.expectContent('block note content');
    await alice.editor.close();

    await alice.openDoc('Persisted BN');
    await alice.editor.expectContent('block note content');
    await expect(alice.page.locator('.bn-container')).toBeVisible();
  });
});

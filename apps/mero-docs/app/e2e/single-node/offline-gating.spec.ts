// While the node connection is down, the tag, archive and delete writes are not
// offered (they would fail); they return once it is back.

import { expect, test } from '../fixtures/single-user';

test.describe('Offline gating (single-node)', () => {
  test('tag, archive and delete are withheld while offline and return online', async ({
    alice,
  }) => {
    const { page } = alice;
    await alice.goToWorkspace();
    await alice.createNamespace('Offline Gate');
    await alice.createFolder({ name: 'Notes', visibility: 'Open' });
    await alice.tree.openFolder('Notes');
    await alice.createDoc('Draft');
    await alice.openDoc('Draft');

    const addTag = alice.tags.row().getByRole('button', { name: 'Add tag' });
    const actions = page.getByRole('button', { name: 'Document actions' });
    const offline = page.getByLabel(/\(offline\)$/);
    const expectMenuOffered = async () => {
      await actions.click();
      for (const name of ['Archive', 'Delete']) {
        await expect(page.getByRole('menuitem', { name })).toBeVisible();
      }
      await page.keyboard.press('Escape');
    };

    await expect(addTag).toBeVisible();
    await expectMenuOffered();

    // The app's connection state follows its event stream, which an open stream
    // survives going offline; refuse the stream and reload so it must reconnect.
    await page.route('**/sse', (route) => route.abort());
    await page.reload();
    await expect(offline).toBeVisible({ timeout: 30_000 });
    await alice.editor.expectMounted();
    await expect(addTag).toHaveCount(0);
    await expect(actions).toHaveCount(0);

    await page.unroute('**/sse');
    await expect(offline).toHaveCount(0, { timeout: 60_000 });
    await expect(addTag).toBeVisible({ timeout: 60_000 });
    await expectMenuOffered();
  });
});

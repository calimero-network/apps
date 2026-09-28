// Search across two nodes: a restricted folder Bob is not in never reaches his
// palette, Bob's edits become searchable for Alice, and a deleted doc drops out.

import { test, expect } from '../fixtures/two-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

const TEXT_GROUP = 'In document text';

async function inviteBob(alice: WorkspaceDriver, bob: WorkspaceDriver) {
  await alice.openSettings();
  const inviteUrl = await alice.settings.copyNamespaceInvite();
  await alice.closeSettings();
  await bob.joinNamespace(inviteUrl);
  await bob.tree.openFolder('Shared');
  await bob.restrictedCard.joinIfPrompted('Shared');
}

test.describe('Search live (two-node)', () => {
  test.beforeEach(async ({ alice }) => {
    await alice.goToWorkspace();
    await alice.createNamespace(`Search Live WS ${Date.now()}`);
    await alice.createFolder({ name: 'Shared', visibility: 'Open' });
    await alice.tree.openFolder('Shared');
    await alice.createDoc('Plan');
  });

  test('a restricted folder Bob is not in never shows in his results (S-18)', async ({
    alice,
    bob,
  }) => {
    await alice.createFolder({ name: 'Finance', visibility: 'Restricted' });
    await alice.tree.openFolder('Finance');
    await alice.createDoc('Budget');
    await alice.openDoc('Budget');
    await alice.editor.type('Payroll figures for the plan');
    await alice.editor.close();
    await inviteBob(alice, bob);

    const { palette } = bob;
    await palette.search('plan');
    await expect(palette.group('Documents').getByRole('option')).toHaveText(
      [/^Plan/],
      { timeout: 60_000 },
    );
    // Once his text search is done, nothing of Finance has turned up.
    await expect(palette.dialog().getByText(/folders searched/)).toBeHidden({
      timeout: 60_000,
    });
    await palette.search('payroll');
    await expect(
      palette.dialog().getByText('No documents, folders or tags match'),
    ).toBeVisible();
    await palette.search('budget');
    await expect(palette.dialog().getByRole('option')).toHaveCount(0);
    await palette.search('finance');
    await expect(palette.dialog().getByRole('option')).toHaveCount(0);
    await expect(palette.dialog()).not.toContainText('Finance');
  });

  test("Bob's new text becomes searchable for Alice (S-19)", async ({
    alice,
    bob,
  }) => {
    await inviteBob(alice, bob);
    await alice.palette.search('zebra');
    await expect(
      alice.palette.dialog().getByText('No documents, folders or tags match'),
    ).toBeVisible({ timeout: 30_000 });

    await bob.openDoc('Plan');
    await bob.editor.type('Meet at the zebra crossing');

    const hit = alice.palette.group(TEXT_GROUP).getByRole('option');
    await expect(hit).toContainText('Plan', { timeout: 60_000 });
    await expect(hit.locator('mark')).toHaveText('zebra');
  });

  test("a doc Bob created and deleted drops out of Alice's results (S-20)", async ({
    alice,
    bob,
  }) => {
    await inviteBob(alice, bob);
    // Only a doc's creator or the folder's founder may delete it.
    await bob.openDoc('Plan');
    await bob.page.getByRole('button', { name: 'Document actions' }).click();
    await expect(bob.page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await expect(
      bob.page.getByRole('menuitem', { name: 'Delete document' }),
    ).toHaveCount(0);
    await bob.page.keyboard.press('Escape');
    await bob.editor.close();

    await bob.createDoc('Minutes');
    await alice.palette.search('minutes');
    const rows = alice.palette.group('Documents').getByRole('option');
    await expect(rows).toHaveText([/^Minutes/], { timeout: 60_000 });

    await bob.openDoc('Minutes');
    await bob.editor.deleteDocument();

    await expect(rows).toHaveCount(0, { timeout: 60_000 });
    await expect(
      alice.palette.dialog().getByText('No documents, folders or tags match'),
    ).toBeVisible();
  });
});

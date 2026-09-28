// Search across two nodes: a restricted folder Bob is not in never reaches his
// palette, Bob's edits become searchable for Alice, and a deleted doc drops out.

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/two-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

const FIELD = 'Search docs, folders and tags'; // the top-bar field's accessible name
const TEXT_GROUP = 'In document text';

function palette(page: Page) {
  return page.getByRole('dialog', { name: 'Search' });
}

async function search(page: Page, text: string) {
  if (!(await palette(page).isVisible())) {
    await page.getByRole('button', { name: FIELD }).click();
  }
  await palette(page).getByRole('textbox', { name: 'Search' }).fill(text);
}

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

    const { page } = bob;
    await search(page, 'plan');
    await expect(
      palette(page)
        .getByRole('group', { name: 'Documents' })
        .getByRole('option'),
    ).toHaveText([/^Plan/], { timeout: 60_000 });
    // Once his text search is done, nothing of Finance has turned up.
    await expect(palette(page).getByText(/folders searched/)).toBeHidden({
      timeout: 60_000,
    });
    await search(page, 'payroll');
    await expect(
      palette(page).getByText('No documents, folders or tags match'),
    ).toBeVisible();
    await search(page, 'budget');
    await expect(palette(page).getByRole('option')).toHaveCount(0);
    await search(page, 'finance');
    await expect(palette(page).getByRole('option')).toHaveCount(0);
    await expect(palette(page)).not.toContainText('Finance');
  });

  test("Bob's new text becomes searchable for Alice (S-19)", async ({
    alice,
    bob,
  }) => {
    await inviteBob(alice, bob);
    await search(alice.page, 'zebra');
    await expect(
      palette(alice.page).getByText('No documents, folders or tags match'),
    ).toBeVisible({ timeout: 30_000 });

    await bob.openDoc('Plan');
    await bob.editor.type('Meet at the zebra crossing');

    const hit = palette(alice.page)
      .getByRole('group', { name: TEXT_GROUP })
      .getByRole('option');
    await expect(hit).toContainText('Plan', { timeout: 60_000 });
    await expect(hit.locator('mark')).toHaveText('zebra');
  });

  test("a doc deleted by Bob drops out of Alice's results (S-20)", async ({
    alice,
    bob,
  }) => {
    await inviteBob(alice, bob);
    await search(alice.page, 'plan');
    const rows = palette(alice.page)
      .getByRole('group', { name: 'Documents' })
      .getByRole('option');
    await expect(rows).toHaveText([/^Plan/]);

    await bob.openDoc('Plan');
    await bob.editor.deleteDocument();

    await expect(rows).toHaveCount(0, { timeout: 60_000 });
    await expect(
      palette(alice.page).getByText('No documents, folders or tags match'),
    ).toBeVisible();
  });
});

// Delete is offered to a doc's creator and to the workspace founder, and to no
// one else: an Editor sees their own doc's Delete but not a peer's.

import { expect, shareOpenDoc, SYNC_MS, test } from '../fixtures/two-user';
import type { WorkspaceDriver } from '../fixtures/workspace';

// Opens the doc's actions, where Archive proves the menu is for this loaded doc.
async function expectDeleteOffered(user: WorkspaceDriver, offered: boolean) {
  await user.page.getByRole('button', { name: 'Document actions' }).click();
  await expect(
    user.page.getByRole('menuitem', { name: 'Archive' }),
  ).toBeVisible();
  const remove = user.page.getByRole('menuitem', { name: 'Delete document' });
  if (offered) await expect(remove).toBeVisible();
  else await expect(remove).toHaveCount(0);
  await user.page.keyboard.press('Escape');
}

test('Delete is offered to the creator and the founder, not to another editor', async ({
  alice,
  bob,
}) => {
  await shareOpenDoc(alice, bob, 'Delete rights WS');
  await bob.createDoc('Notes');
  await alice.docs.expectDocVisible('Notes', { timeout: SYNC_MS });

  await alice.openDoc('Plan');
  await expectDeleteOffered(alice, true);
  await bob.openDoc('Plan');
  await expectDeleteOffered(bob, false);

  await bob.openDoc('Notes');
  await expectDeleteOffered(bob, true);
  await alice.openDoc('Notes');
  await expectDeleteOffered(alice, true);
});

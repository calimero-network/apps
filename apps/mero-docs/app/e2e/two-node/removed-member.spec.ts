// A member removed from an Open folder while reading it lands on the same
// closed-folder screen as a Restricted folder they are not in, not a broken editor.

import { expect, shareOpenDoc, SYNC_MS, test } from '../fixtures/two-user';

test.describe('Removed member (two-node)', () => {
  test('a member removed from an open folder is shown the closed-folder card', async ({
    alice,
    bob,
  }) => {
    await shareOpenDoc(alice, bob, 'Removed WS');
    await bob.openDoc('Plan');
    const docUrl = new URL(bob.page.url()).pathname;

    await alice.openFolderInfo('Team');
    await alice.sharing.expectMemberVisible('bob');
    await alice.sharing.removeMember('bob');
    await alice.closeFolderInfo();

    await expect(bob.page.getByText('This document is in Team')).toBeVisible({
      timeout: SYNC_MS,
    });
    await expect(bob.page.locator('.ProseMirror')).toHaveCount(0);
    expect(new URL(bob.page.url()).pathname).toBe(docUrl);

    await bob.tree.openFolder('Team');
    await expect(
      bob.page.getByRole('heading', { name: 'Team is a restricted folder' }),
    ).toBeVisible();
    await expect(bob.page.getByText('You are not a member yet.')).toBeVisible();
  });
});

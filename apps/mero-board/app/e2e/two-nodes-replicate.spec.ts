// A board built on node 0 reaches node 1, and a drag on node 1 reaches node 0's
// open page without a reload. The folder is added AFTER node 1 joined, so node 1
// has to pick up a context it was never injected into (the join-sync path).
import { test, expect } from '@playwright/test';
import {
  loginViaHash, clearAuth, inviteAndJoin, addFolder, createBoard, addList, addCard, dragCard, listByName,
  uniqueName, skipAliasGate,
} from './helpers';

test.describe('two nodes', () => {
  test('a board, its lists and a card replicate; a move on node 1 shows on node 0 live', async ({ browser }) => {
    test.setTimeout(240_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await loginViaHash(pageA, 0);
      await loginViaHash(pageB, 1);
      await inviteAndJoin(pageA, pageB);

      const folder = uniqueName('shared');
      const card = uniqueName('card');
      await addFolder(pageA, folder);
      await createBoard(pageA, 'Roadmap');
      await addList(pageA, 'Todo');
      await addList(pageA, 'Doing');
      await addCard(pageA, 'Todo', card);

      // Node 1: the folder shows up in the sidebar once the namespace syncs.
      const item = pageB.getByTestId('folder-list-item').filter({ hasText: folder });
      // Live first; one reload as the fallback for a page that missed the update.
      const seenLive = await item.first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
      if (!seenLive) {
        await pageB.reload();
        await skipAliasGate(pageB, 3_000).catch(() => {});
        await expect(item.first()).toBeVisible({ timeout: 60_000 });
      }
      await item.first().click();
      await expect(pageB.getByTestId('folder-header-name')).toHaveText(folder, { timeout: 30_000 });
      const tile = pageB.getByTestId('item-board').filter({ hasText: 'Roadmap' });
      await expect(tile).toBeVisible({ timeout: 90_000 });
      await tile.click();
      await expect(pageB.getByTestId('board-name')).toHaveText('Roadmap', { timeout: 30_000 });
      await expect(listByName(pageB, 'Todo').getByTestId('item-card').filter({ hasText: card }))
        .toBeVisible({ timeout: 60_000 });
      await expect(listByName(pageB, 'Doing')).toBeVisible({ timeout: 60_000 });

      await dragCard(pageB, card, 'Doing');

      // Node 0's page is still open on the board: the move arrives without a reload.
      await expect(listByName(pageA, 'Doing').getByTestId('item-card').filter({ hasText: card }))
        .toBeVisible({ timeout: 30_000 });
      await expect(listByName(pageA, 'Todo').getByTestId('item-card').filter({ hasText: card }))
        .toHaveCount(0);
    } finally {
      await clearAuth(pageA).catch(() => {});
      await clearAuth(pageB).catch(() => {});
      await ctxA.close();
      await ctxB.close();
    }
  });
});

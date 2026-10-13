import { test, expect } from '@playwright/test';
import {
  loginViaHash, createWorkspace, addFolder, createBoard, addList, uniqueName, listByName, clearAuth, dragList, listOrder, openMenu,
} from './helpers';

test.describe('boards and lists', () => {
  test.afterEach(async ({ page }) => { await clearAuth(page); });

  test('create a folder, a board, lists; rename and delete a list', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await addFolder(page, uniqueName('folder'));
    await createBoard(page, 'Launch');
    await addList(page, 'Todo');
    await addList(page, 'Doing');
    await addList(page, 'Spare');
    await expect(page.getByTestId('item-list')).toHaveCount(3);

    // While renaming, the title is replaced by the form, so address the column by id.
    const spareId = await listByName(page, 'Spare').getAttribute('data-list-id');
    const spare = page.locator(`[data-testid="item-list"][data-list-id="${spareId}"]`);
    await spare.getByTestId('list-menu').locator('summary').click();
    await spare.getByTestId('list-rename').click();
    await spare.getByTestId('list-rename-input').fill('Later');
    await spare.getByTestId('list-rename-submit').click();
    await expect(listByName(page, 'Later')).toBeVisible();
    await expect(listByName(page, 'Spare')).toHaveCount(0);

    const later = listByName(page, 'Later');
    await later.getByTestId('list-menu').locator('summary').click();
    await later.getByTestId('list-delete').click();
    await expect(page.getByTestId('item-list')).toHaveCount(2);

    // Persisted, not just optimistic.
    await page.reload();
    await expect(page.getByTestId('item-list')).toHaveCount(2, { timeout: 30_000 });
    await expect(listByName(page, 'Todo')).toBeVisible();
    await expect(listByName(page, 'Doing')).toBeVisible();

    await page.getByTestId('action-back').click();
    await expect(page.getByTestId('folder-page')).toBeVisible();
    await expect(page.getByTestId('item-board')).toHaveCount(1, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('item-board').filter({ hasText: 'Launch' })).toBeVisible({ timeout: 30_000 });
  });

  test('drag a list to the front; rename, archive and delete the board from its menu', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await addFolder(page, uniqueName('folder'));
    await createBoard(page, 'Roadmap');
    await addList(page, 'Now');
    await addList(page, 'Next');
    await addList(page, 'Later');
    await expect.poll(() => listOrder(page)).toEqual(['Now', 'Next', 'Later']);

    await dragList(page, 'Later', 'Now');
    await expect.poll(() => listOrder(page), { timeout: 15_000 }).toEqual(['Later', 'Now', 'Next']);
    await page.reload();
    await expect(page.getByTestId('item-list')).toHaveCount(3, { timeout: 30_000 });
    await expect.poll(() => listOrder(page), { timeout: 30_000 }).toEqual(['Later', 'Now', 'Next']);

    const menu = page.getByTestId('board-menu');
    await openMenu(menu);
    await menu.getByTestId('board-rename').click();
    await menu.getByTestId('board-rename-input').fill('Roadmap 2');
    await menu.getByTestId('board-rename-submit').click();
    await expect(page.getByTestId('board-name')).toHaveText('Roadmap 2', { timeout: 30_000 });

    await openMenu(menu);
    await menu.getByTestId('board-archive').click();
    await expect(page.getByTestId('board-archived-tag')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('action-back').click();
    await expect(page.getByTestId('folder-page')).toBeVisible();
    const tile = page.getByTestId('item-board').filter({ hasText: 'Roadmap 2' });
    await expect(tile).toHaveCount(0, { timeout: 30_000 });
    await page.getByTestId('toggle-archived').check();
    await expect(tile).toBeVisible({ timeout: 30_000 });
    await expect(tile).toHaveAttribute('data-archived', 'true');

    await tile.click();
    await expect(page.getByTestId('board-name')).toHaveText('Roadmap 2', { timeout: 30_000 });
    await openMenu(menu);
    await menu.getByTestId('board-delete').click();
    await menu.getByTestId('confirm-delete_board').click();
    await expect(page.getByTestId('folder-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('toggle-archived').check();
    await expect(page.getByTestId('item-board').filter({ hasText: 'Roadmap 2' })).toHaveCount(0, { timeout: 30_000 });
  });
});

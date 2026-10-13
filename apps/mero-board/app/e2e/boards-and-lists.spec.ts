import { test, expect } from '@playwright/test';
import { loginViaHash, createWorkspace, addFolder, createBoard, addList, uniqueName, listByName, clearAuth } from './helpers';

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
});

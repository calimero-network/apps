import { test, expect } from '@playwright/test';
import {
  loginViaHash, createWorkspace, addFolder, createBoard, addList, addCard, dragCard, openCard, listByName,
  uniqueName, clearAuth, dragList, listOrder,
} from './helpers';

test.describe('cards', () => {
  test.afterEach(async ({ page }) => { await clearAuth(page); });

  test('add, drag between lists, edit in the modal, delete list refuses while occupied', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await addFolder(page, uniqueName('folder'));
    await createBoard(page, 'Launch');
    await addList(page, 'Todo');
    await addList(page, 'Doing');
    await addCard(page, 'Todo', 'Write the post');
    await addCard(page, 'Todo', 'Book the venue');

    await dragCard(page, 'Write the post', 'Doing');
    await page.reload();
    await expect(listByName(page, 'Doing').getByTestId('item-card').filter({ hasText: 'Write the post' }))
      .toBeVisible({ timeout: 30_000 });
    await expect(listByName(page, 'Todo').getByTestId('item-card').filter({ hasText: 'Write the post' }))
      .toHaveCount(0);

    const doing = listByName(page, 'Doing');
    await doing.getByTestId('list-menu').locator('summary').click();
    await doing.getByTestId('list-delete').click();
    await expect(doing.getByTestId('list-error')).toBeVisible();
    await expect(page.getByTestId('item-list')).toHaveCount(2);

    await openCard(page, 'Write the post');
    const modal = page.getByTestId('card-modal');
    await page.getByTestId('field-description').fill('Draft is in the shared doc.');
    await page.getByTestId('action-set_description').click();
    await expect(page.getByTestId('action-set_description')).toHaveCount(0);

    await page.getByTestId('action-add_label').click();
    await page.getByTestId('field-label').fill('marketing');
    await page.getByTestId('label-submit').click();
    await expect(modal.locator('[data-testid="action-remove_label"][data-label="marketing"]')).toBeVisible();

    await page.getByTestId('field-checklist').fill('Outline');
    await page.getByTestId('action-add_checklist_item').click();
    await expect(page.getByTestId('item-checklist')).toHaveCount(1);
    // Controlled by the node's answer, so click and wait rather than check().
    await page.getByTestId('checklist-toggle').click();
    await expect(page.getByTestId('checklist-toggle')).toBeChecked();

    await page.getByTestId('field-body').fill('Looks good');
    await page.getByTestId('action-add_comment').click();
    await expect(page.getByTestId('item-comment')).toHaveCount(1);
    await expect(page.getByTestId('item-comment')).toContainText('Looks good');
    await page.getByTestId('action-close').click();
    await expect(modal).toHaveCount(0);

    const card = page.getByTestId('item-card').filter({ hasText: 'Write the post' });
    await expect(card).toContainText('1/1');
    await expect(card).toContainText('marketing');

    // The edits are on the node, not only in the open modal.
    await page.reload();
    await openCard(page, 'Write the post');
    await expect(page.getByTestId('field-description')).toHaveValue('Draft is in the shared doc.');
    await expect(page.getByTestId('item-comment')).toContainText('Looks good');
    await page.getByTestId('action-close').click();

    await openCard(page, 'Book the venue');
    await page.getByTestId('action-delete_card').click();
    await page.getByTestId('confirm-delete_card').click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('item-card').filter({ hasText: 'Book the venue' })).toHaveCount(0);
  });

  test('archive a card, show it muted with the toggle, unarchive and move it from the modal', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await addFolder(page, uniqueName('folder'));
    await createBoard(page, 'Launch');
    await addList(page, 'Todo');
    await addList(page, 'Doing');
    await addCard(page, 'Todo', 'Keep');
    await addCard(page, 'Todo', 'Shelve');
    const todo = listByName(page, 'Todo');
    const shelve = page.getByTestId('item-card').filter({ hasText: 'Shelve' });

    await openCard(page, 'Shelve');
    const modal = page.getByTestId('card-modal');
    // Escape in a nested form cancels the form, not the modal.
    await page.getByTestId('action-add_label').click();
    await page.getByTestId('field-label').press('Escape');
    await expect(page.getByTestId('field-label')).toHaveCount(0);
    await expect(modal).toBeVisible();

    await page.getByTestId('action-archive_card').click();
    await expect(page.getByTestId('action-archive_card')).toHaveText('Unarchive', { timeout: 30_000 });
    await page.getByTestId('action-close').click();
    await expect(todo.getByTestId('item-card').filter({ hasText: 'Shelve' })).toHaveCount(0, { timeout: 30_000 });
    await expect(todo.getByTestId('item-card').filter({ hasText: 'Keep' })).toBeVisible();

    await page.getByTestId('toggle-archived-cards').check();
    await expect(shelve).toBeVisible({ timeout: 30_000 });
    await expect(shelve).toHaveAttribute('data-archived', 'true');
    await expect(shelve).toHaveCSS('opacity', '0.55');

    // A card added after the archived one still lands last, below it.
    await addCard(page, 'Todo', 'Fresh');
    await expect.poll(() => todo.getByTestId('card-title').allInnerTexts()).toEqual(['Keep', 'Shelve', 'Fresh']);

    await openCard(page, 'Shelve');
    await page.getByTestId('action-archive_card').click();
    await expect(page.getByTestId('action-archive_card')).toHaveText('Archive', { timeout: 30_000 });
    await page.getByTestId('field-list').selectOption({ label: 'Doing' });
    await page.getByTestId('action-close').click();
    await page.getByTestId('toggle-archived-cards').uncheck();
    const moved = listByName(page, 'Doing').getByTestId('item-card').filter({ hasText: 'Shelve' });
    await expect(moved).toBeVisible({ timeout: 30_000 });
    await expect(moved).not.toHaveAttribute('data-archived', 'true');

    // Card drags still work with sortable columns, and a list drag carries its cards.
    await dragCard(page, 'Keep', 'Doing');
    await dragList(page, 'Doing', 'Todo');
    await expect.poll(() => listOrder(page), { timeout: 15_000 }).toEqual(['Doing', 'Todo']);
    await expect(listByName(page, 'Doing').getByTestId('item-card')).toHaveCount(2);
  });
});

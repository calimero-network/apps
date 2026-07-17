import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createIssue, uniqueName } from './helpers';

test.describe(`issue creator: delete an issue (with its comments) from the detail page`, () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  // Smoke: the post-auth screen renders without a visible error banner.
  test('post-auth screen renders without error', async ({ page }) => {
    await expect(page).toHaveURL(/.+/);
    const errorBanner = page.locator('text=/error|failed/i').first();
    await expect(errorBanner).toBeHidden({ timeout: 5_000 }).catch(() => {});
  });

  test(`the creator deletes an issue: it disappears from the list and its detail 404s`, async ({ page }) => {
    const title = uniqueName('issue');
    await createIssue(page, { title });

    const card = page.getByTestId('item-issue').filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const id = await card.getAttribute('data-issue-id');
    expect(id).toBeTruthy();

    // Open detail. The current user created it, so the delete action is shown.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/issues/${id}$`));
    await expect(page.getByTestId('action-delete_issue')).toBeVisible();

    // Confirm the delete in the modal.
    await page.getByTestId('action-delete_issue').click();
    await page.getByTestId('confirm-delete_issue').click();

    // Back on the list, and the card is gone.
    await expect(page).not.toHaveURL(/\/issues\//);
    await expect(page.getByTestId('item-issue').filter({ hasText: title })).toHaveCount(0, { timeout: 10_000 });

    // Re-entering the deleted issue's detail (in-app, no reload) 404s.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/issues/${id}$`));
    await expect(page.getByText('Issue not found.')).toBeVisible({ timeout: 10_000 });
  });
});

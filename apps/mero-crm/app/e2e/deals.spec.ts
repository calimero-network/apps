// The core loop: add a deal, see it on the board, move it through the stages
// from its page, close it won, reopen it, and close it lost with a reason.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createDeal, uniqueName } from './helpers';

test.describe('deals: create, move, close', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('a new deal lands in its stage and the column count rises by one', async ({ page }) => {
    const count = page.getByTestId('count-stage-lead');
    await expect(count).toBeVisible({ timeout: 15_000 });
    const before = parseInt((await count.innerText()).trim(), 10) || 0;

    const title = uniqueName('deal');
    await createDeal(page, { title, value: '5000', organization: 'Acme' });
    const column = page.locator('[data-testid="stage-column"][data-stage-id="stage-lead"]');
    await expect(column.getByTestId('deal-card').filter({ hasText: title })).toBeVisible({ timeout: 10_000 });
    await expect(count).toHaveText(String(before + 1), { timeout: 10_000 });
  });

  test('move through the stage stepper, then win, reopen and lose', async ({ page }) => {
    const title = uniqueName('deal');
    await createDeal(page, { title, value: '8k' });
    await page.getByTestId('deal-card').filter({ hasText: title }).click();
    await expect(page.getByTestId('deal-title')).toHaveText(title, { timeout: 10_000 });

    await page.locator('[data-testid="stage-step"][data-stage-id="stage-proposal"]').click();
    await expect(page.locator('[data-testid="stage-step"][data-stage-id="stage-proposal"]')).toHaveClass(/current/, { timeout: 10_000 });

    await page.getByTestId('mark-won').click();
    await expect(page.getByTestId('deal-status').first()).toHaveText('Won', { timeout: 10_000 });

    await page.getByTestId('reopen-deal').click();
    await expect(page.getByTestId('deal-status').first()).toHaveText('Open', { timeout: 10_000 });

    await page.getByTestId('mark-lost').click();
    await page.getByTestId('lost-reason-input').fill('Price');
    await page.getByTestId('lost-confirm').click();
    await expect(page.getByTestId('deal-status').first()).toHaveText('Lost', { timeout: 10_000 });

    // Closed deals leave the board and show under the Lost tab.
    await page.getByTestId('nav-deals').click();
    await page.getByTestId('deals-tab-lost').click();
    await expect(page.getByTestId('deal-row').filter({ hasText: title })).toBeVisible({ timeout: 10_000 });
  });
});

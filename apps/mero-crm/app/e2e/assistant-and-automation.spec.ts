// The two "do it for me" features: the deal assistant schedules its suggested
// next step in one click, and an automation schedules a follow-up by itself
// when a deal enters a stage.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, createDeal, uniqueName } from './helpers';

test.describe('assistant and automations', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('a deal with no next step gets one from the assistant in one click', async ({ page }) => {
    const title = uniqueName('deal');
    await createDeal(page, { title });
    const card = page.getByTestId('deal-card').filter({ hasText: title });
    await expect(card.getByTestId('no-next-step')).toBeVisible({ timeout: 10_000 });

    await card.click();
    await expect(page.getByTestId('assistant-panel')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('suggestion-playbook').click();
    await expect(page.getByTestId('deal-activity')).toHaveCount(1, { timeout: 10_000 });

    await page.getByTestId('nav-pipeline').click();
    await expect(card.getByTestId('no-next-step')).toBeHidden({ timeout: 10_000 });
  });

  test('entering a stage with an automation schedules its activity', async ({ page }) => {
    const subject = uniqueName('Send proposal');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('auto-stage').selectOption('stage-proposal');
    await page.getByTestId('auto-subject').fill(subject);
    await page.getByTestId('auto-add').click();
    await expect(page.getByTestId('automation-row').filter({ hasText: subject })).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('nav-pipeline').click();
    const title = uniqueName('deal');
    await createDeal(page, { title, stageId: 'stage-proposal' });
    await page.getByTestId('deal-card').filter({ hasText: title }).click();
    await expect(page.getByTestId('deal-activity').filter({ hasText: subject })).toBeVisible({ timeout: 10_000 });
  });
});

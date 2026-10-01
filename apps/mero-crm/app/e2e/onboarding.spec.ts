// Explicit onboarding: with no SSO context injected, a fresh session lands on
// the namespace empty state and must be walked through create-namespace ->
// alias gate -> add-pipeline before the board is usable. Runs on node 2, which
// no other spec provisions or joins, so its namespace list starts empty.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createDeal, uniqueName } from './helpers';

test.describe('onboarding: explicit namespace + pipeline before the board', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('create workspace -> set name -> add a EUR pipeline -> add a deal', async ({ page }) => {
    await loginViaHash(page, 2, { inject: false });

    const emptyState = page.getByTestId('ns-empty-state');
    const createBtn = page.getByTestId('ns-create-btn');
    await Promise.race([
      emptyState.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      page.getByTestId('ns-switcher').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    ]);

    await createBtn.first().click();
    await page.getByTestId('ns-create-name').fill(uniqueName('Sales'));
    await page.getByTestId('ns-create-submit').click();

    // Blocking alias gate: set a display name; it resolves onto the identity label.
    const gateName = `rep-${Date.now().toString(36)}`;
    const gate = page.getByTestId('alias-gate');
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('alias-gate-name').fill(gateName);
    await page.getByTestId('alias-gate-save').click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(gateName, { timeout: 10_000 });

    // No pipelines yet: add one, in euros.
    const name = uniqueName('New business');
    await page.getByTestId('pipeline-add-btn').click();
    await page.getByTestId('pipeline-add-name').fill(name);
    await page.getByTestId('pipeline-add-currency').fill('EUR');
    await page.getByTestId('pipeline-add-submit').click();

    await page.getByTestId('workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.getByTestId('pipeline-list-item').filter({ hasText: name })).toBeVisible({ timeout: 10_000 });
    // The default five stages are there.
    await expect(page.getByTestId('stage-column')).toHaveCount(5, { timeout: 15_000 });

    const title = uniqueName('deal');
    await createDeal(page, { title, value: '12k' });
    const card = page.getByTestId('deal-card').filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    // Valued in the pipeline's currency, and owned by whoever created it.
    await expect(card).toContainText('12,000');
    await expect(card).toContainText('€');
  });
});

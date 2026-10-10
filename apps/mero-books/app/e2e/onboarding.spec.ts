// Explicit onboarding: with no SSO context injected, a fresh session lands on
// the namespace empty state and must be walked through create-namespace ->
// alias gate -> add-organisation before the books are usable. Runs on node 2, which
// no other spec provisions or joins, so its namespace list starts empty.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createInvoice, uniqueName } from './helpers';

test.describe('onboarding: explicit namespace + organisation before the books', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('create workspace -> set name -> add a EUR organisation -> invoice in euros', async ({ page }) => {
    await loginViaHash(page, 2, { inject: false });

    const emptyState = page.getByTestId('ns-empty-state');
    const createBtn = page.getByTestId('ns-create-btn');
    await Promise.race([
      emptyState.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      page.getByTestId('ns-switcher').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    ]);

    await createBtn.first().click();
    await page.getByTestId('ns-create-name').fill(uniqueName('Practice'));
    await page.getByTestId('ns-create-submit').click();

    // Blocking alias gate: set a display name; it resolves onto the identity label.
    const gateName = `rep-${Date.now().toString(36)}`;
    const gate = page.getByTestId('alias-gate');
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('alias-gate-name').fill(gateName);
    await page.getByTestId('alias-gate-save').click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(gateName, { timeout: 10_000 });

    // No organisations yet: add one, in euros.
    const name = uniqueName('Acme Ltd');
    await page.getByTestId('organisation-add-btn').click();
    await page.getByTestId('organisation-add-name').fill(name);
    await page.getByTestId('organisation-add-currency').fill('EUR');
    await page.getByTestId('organisation-add-submit').click();

    await page.getByTestId('workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.getByTestId('organisation-list-item').filter({ hasText: name })).toBeVisible({ timeout: 10_000 });
    // The dashboard is the home, headed with the organisation's own name:
    // creating it wrote the name and currency into the books' settings.
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard').locator('h1')).toHaveText(name, { timeout: 15_000 });

    await createInvoice(page, { contact: uniqueName('Customer'), description: 'Consulting', price: '1000', approve: true });
    // The default Sales account carries the standard 20% rate.
    await expect(page.getByTestId('invoice-total')).toHaveText('1,200.00');
    await expect(page.getByTestId('invoice-amount-due')).toContainText('€');
    await expect(page.getByTestId('invoice-number')).toHaveText(/^INV-\d{4}$/);
  });
});

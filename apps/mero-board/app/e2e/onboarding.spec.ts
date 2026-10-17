// Explicit onboarding: with no SSO context injected, a fresh session lands on
// the namespace empty state and must be walked through create-namespace ->
// alias gate -> add-folder before the workspace is usable. Runs on node 2, which no
// other spec provisions or joins, so its namespace list starts empty.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, uniqueName } from './helpers';

test.describe('onboarding: explicit namespace + folder before the board', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('create workspace -> set name -> add folder -> folder is active', async ({ page }) => {
    await loginViaHash(page, 2, { inject: false });

    // First run on this node shows the passive empty state (not a bare board).
    // On a retry the namespace already exists, so this is best-effort.
    const emptyState = page.getByTestId('ns-empty-state');
    const createBtn = page.getByTestId('ns-create-btn');
    await Promise.race([
      emptyState.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
      page.getByTestId('ns-switcher').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    ]);

    // Create the namespace (name required).
    await createBtn.first().click();
    await page.getByTestId('ns-create-name').fill(uniqueName('Team'));
    await page.getByTestId('ns-create-submit').click();

    // Blocking alias gate: set a display name; it resolves onto the identity label.
    const gateName = `dev-${Date.now().toString(36)}`;
    const gate = page.getByTestId('alias-gate');
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('alias-gate-name').fill(gateName);
    await page.getByTestId('alias-gate-save').click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(gateName, { timeout: 10_000 });

    // No folders yet: add one by name.
    await page.getByTestId('folder-add-btn').click();
    await page.getByTestId('folder-add-name').fill('core');
    await page.getByTestId('folder-add-submit').click();

    // The workspace becomes ready, the folder shows in the rail, and its name
    // is surfaced in the header.
    await page.getByTestId('workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.getByTestId('folder-list-item').filter({ hasText: 'core' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('folder-header-name')).toHaveText('core', { timeout: 10_000 });
  });
});

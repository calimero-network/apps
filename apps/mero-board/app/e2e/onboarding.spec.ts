// Explicit onboarding: with no SSO context injected, a fresh session lands on
// the namespace empty state and must be walked through create-namespace ->
// alias gate -> add-repo before the board is usable. Runs on node 2, which no
// other spec provisions or joins, so its namespace list starts empty.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, skipAliasGate, createIssue, uniqueName } from './helpers';

test.describe('onboarding: explicit namespace + repo before the board', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('create workspace -> set name -> add repo with a GitHub URL -> track issues', async ({ page }) => {
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

    // No repos yet: add one with a required GitHub URL.
    const repoUrl = `https://github.com/acme/${Date.now().toString(36)}`;
    await page.getByTestId('repo-add-btn').click();
    await page.getByTestId('repo-add-name').fill('core');
    await page.getByTestId('repo-add-url').fill(repoUrl);
    await page.getByTestId('repo-add-submit').click();

    // The board becomes ready, the repo shows in the rail, and its GitHub link
    // is surfaced in the header.
    await page.getByTestId('workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.getByTestId('repo-list-item').filter({ hasText: 'core' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('repo-header-link')).toHaveAttribute('href', repoUrl, { timeout: 10_000 });

    // Issues are scoped to the repo: create one and see it on the board.
    const title = uniqueName('issue');
    await createIssue(page, { title });
    await expect(page.getByTestId('item-issue').filter({ hasText: title })).toBeVisible({ timeout: 10_000 });
  });
});

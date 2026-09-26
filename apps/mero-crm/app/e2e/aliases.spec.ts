// Alias coverage: the pipeline context alias registered by Add pipeline, and an
// identity alias set through the UI resolving back onto the current identity.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, getNode, openAliasModal } from './helpers';

test.describe('aliases: pipeline context alias + identity alias set via the UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('the alias created by Add pipeline resolves to the new pipeline context', async ({ page }) => {
    // Node aliases only allow [A-Za-z0-9._-] (no spaces).
    const name = `pipeline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await page.getByTestId('pipeline-add-btn').click();
    await page.getByTestId('pipeline-add-name').fill(name);
    await page.getByTestId('pipeline-add-submit').click();
    await expect(page.getByTestId('pipeline-list-item').filter({ hasText: name })).toBeVisible({ timeout: 10_000 });

    const node = getNode(0);
    let value: string | undefined;
    for (let i = 0; i < 20 && !value; i++) {
      const res = await fetch(
        `${node.adminUrl}/admin-api/alias/lookup/context/${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.accessToken}` },
          body: '{}',
        },
      );
      if (res.ok) {
        const json = await res.json().catch(() => null);
        value = json?.data?.value ?? undefined;
      }
      if (!value) await new Promise((r) => setTimeout(r, 500));
    }
    expect(value, `context alias "${name}" never resolved to a context id`).toBeTruthy();
  });

  test('an identity alias set via the UI resolves onto the current identity', async ({ page }) => {
    const alias = `tester-${Date.now().toString(36)}`;
    await page.getByTestId('nav-members').click();
    const input = await openAliasModal(page);
    await input.fill(alias);
    await page.getByTestId('alias-save-btn').click();
    await expect(input).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(alias, { timeout: 10_000 });
  });
});

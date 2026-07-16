// Alias coverage: the well-known context alias registered on bootstrap, and an
// identity alias set through the UI resolving back onto the current identity.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, getNode } from './helpers';

const WORKSPACE_ALIAS = 'issue-tracker';

test.describe('aliases: context bootstrap alias + identity alias set via the UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test(`the well-known "${WORKSPACE_ALIAS}" context alias is registered on bootstrap`, async () => {
    // useWorkspace registers the alias once a context exists; it is async and
    // best-effort, so poll the admin-api until the lookup resolves to a context.
    const node = getNode(0);
    let value: string | undefined;
    for (let i = 0; i < 20 && !value; i++) {
      const res = await fetch(
        `${node.adminUrl}/admin-api/alias/lookup/context/${WORKSPACE_ALIAS}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${node.accessToken}`,
          },
          body: '{}',
        },
      );
      if (res.ok) {
        const json = await res.json().catch(() => null);
        value = json?.data?.value ?? undefined;
      }
      if (!value) await new Promise((r) => setTimeout(r, 500));
    }
    expect(value, `context alias "${WORKSPACE_ALIAS}" never resolved to a context id`).toBeTruthy();
  });

  test('an identity alias set via the UI resolves onto the current identity', async ({ page }) => {
    const alias = `tester-${Date.now().toString(36)}`;

    await page.getByTestId('nav-members').click();
    // A fresh identity gets the auto-opened "set your alias" nudge; fill it.
    // (If it didn't auto-open, the explicit button opens the same modal.)
    const input = page.getByTestId('alias-input');
    if (!(await input.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await page.getByTestId('set-alias-btn').click();
    }
    await input.fill(alias);
    await page.getByTestId('alias-save-btn').click();

    // The alias round-trips node-side and resolves back onto the current
    // identity's label (aliases.resolve(currentUser)) in the app chrome.
    await expect(input).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(alias, { timeout: 10_000 });
  });
});

// Alias coverage: the folder context alias registered by Add folder, and an
// identity alias set through the UI resolving back onto the current identity.
import { test, expect } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, getNode, openAliasModal } from './helpers';

test.describe('aliases: folder context alias + identity alias set via the UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
  });

  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('the folder alias created by Add folder resolves to the active folder context', async ({ page }) => {
    // createWorkspace's isolated fixture provisions its base folder straight
    // through the admin-api (no alias); add a folder through the UI so addFolder's
    // createContextAlias path actually runs, with a name we control. Node
    // aliases only allow [A-Za-z0-9._-] (no spaces), unlike uniqueName's
    // human-readable "prefix timestamp-rand" form.
    const folderName = `aliased-folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await page.getByTestId('folder-add-btn').click();
    await page.getByTestId('folder-add-name').fill(folderName);
    await page.getByTestId('folder-add-submit').click();
    await expect(page.getByTestId('folder-list-item').filter({ hasText: folderName })).toBeVisible({ timeout: 10_000 });

    // addFolder registers the alias right after createContext; it is best-effort,
    // so poll the admin-api until the lookup resolves to a context.
    const node = getNode(0);
    let value: string | undefined;
    for (let i = 0; i < 20 && !value; i++) {
      const res = await fetch(
        `${node.adminUrl}/admin-api/alias/lookup/context/${encodeURIComponent(folderName)}`,
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
    expect(value, `context alias "${folderName}" never resolved to a context id`).toBeTruthy();
  });

  test('an identity alias set via the UI resolves onto the current identity', async ({ page }) => {
    const alias = `tester-${Date.now().toString(36)}`;

    await page.getByTestId('nav-members').click();
    const input = await openAliasModal(page);
    await input.fill(alias);
    await page.getByTestId('alias-save-btn').click();

    // The alias round-trips node-side and resolves back onto the current
    // identity's label (aliases.resolve(currentUser)) in the app chrome.
    await expect(input).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('current-identity-label')).toHaveText(alias, { timeout: 10_000 });
  });
});

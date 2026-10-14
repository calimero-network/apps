// Log out: from the sidebar's identity block, or from Settings → Your account.
// Either way the session is gone (mero-react's token store and `mero:*` keys,
// plus this app's workspace selection), the visitor is back on the front door,
// and a reload or a deep link into the app does not sneak them back in.
import { test, expect, Page } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace } from './helpers';

async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.locator('.cal-lp-root')).toBeVisible({ timeout: 15_000 });
  const left = await page.evaluate(() => ({
    tokens: localStorage.getItem('mero-tokens'),
    accessToken: localStorage.getItem('mero:access_token'),
    contextId: localStorage.getItem('mero:context_id'),
    activeNs: localStorage.getItem('crm:activeNs:v2'),
  }));
  expect(left).toEqual({ tokens: null, accessToken: null, contextId: null, activeNs: null });

  // Still signed out after a reload, and the app route sends them home.
  await page.reload();
  await expect(page.locator('.cal-lp-root')).toBeVisible({ timeout: 15_000 });
  await page.goto('/crm');
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId('workspace-ready')).toHaveCount(0);
}

test.describe('log out', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('the sidebar Log out button ends the session and returns to the landing page', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await page.getByTestId('logout-btn').click();
    await expectSignedOut(page);
  });

  test('on a phone, Log out is in the nav drawer the top bar opens', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // No rail on a phone: the nav lives behind the menu button.
    await expect(page.getByTestId('nav-pipeline')).toHaveCount(0);
    await page.getByTestId('mobile-nav-btn').click();
    const drawer = page.getByTestId('mobile-nav');
    await expect(drawer).toBeVisible();
    // Navigating closes the drawer.
    await drawer.getByTestId('nav-contacts').click();
    await expect(page).toHaveURL(/\/crm\/contacts$/);
    await expect(drawer).toHaveCount(0);
    // Nothing on the page is wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByTestId('mobile-nav-btn').click();
    await page.getByTestId('mobile-nav').getByTestId('logout-btn').click();
    await expectSignedOut(page);
  });

  test('Settings → Your account → Log out does the same, and keeps the theme choice', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('appearance-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('settings-logout-btn').click();
    await expectSignedOut(page);
    expect(await page.evaluate(() => localStorage.getItem('mero-crm:theme'))).toBe('dark');
    await page.evaluate(() => localStorage.removeItem('mero-crm:theme'));
  });
});

// Log out, from the identity block at the foot of the sidebar. The session is
// gone (mero-react's token store and `mero:*` keys, plus this app's workspace
// and repo selection), the visitor is back on the front door, and a reload or
// a deep link into the app does not sneak them back in.
import { test, expect, Page } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace } from './helpers';

async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.locator('.cal-lp-root')).toBeVisible({ timeout: 15_000 });
  const left = await page.evaluate(() => ({
    tokens: localStorage.getItem('mero-tokens'),
    accessToken: localStorage.getItem('mero:access_token'),
    contextId: localStorage.getItem('mero:context_id'),
    activeNs: localStorage.getItem('issue-tracker:activeNs:v2'),
    activeRepo: Object.keys(localStorage).filter((k) => k.startsWith('issue-tracker:activeRepo:')),
  }));
  expect(left).toEqual({ tokens: null, accessToken: null, contextId: null, activeNs: null, activeRepo: [] });

  // Still signed out after a reload, and the app route sends them home.
  await page.reload();
  await expect(page.locator('.cal-lp-root')).toBeVisible({ timeout: 15_000 });
  await page.goto('/issue-tracker');
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId('workspace-ready')).toHaveCount(0);
}

test.describe('log out', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('mero-issue-tracker:theme')).catch(() => {});
    await clearAuth(page);
  });

  test('the sidebar Log out button ends the session and returns to the landing page', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await page.getByTestId('logout-btn').click();
    await expectSignedOut(page);
  });

  test('on a phone, the nav and Log out are in the drawer the top bar opens', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // No rail on a phone: the nav lives behind the menu button.
    await expect(page.getByTestId('nav-my-issues')).toHaveCount(0);
    await page.getByTestId('mobile-nav-btn').click();
    const drawer = page.getByTestId('mobile-nav');
    await expect(drawer).toBeVisible();
    // Navigating closes the drawer.
    await drawer.getByTestId('nav-my-issues').click();
    await expect(page).toHaveURL(/\/issue-tracker\?assignee=me$/);
    await expect(drawer).toHaveCount(0);
    // Nothing on the page is wider than the phone, here or on the board.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId('mobile-nav-btn').click();
    await page.getByTestId('mobile-nav').getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/\/issue-tracker\/board$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByTestId('mobile-nav-btn').click();
    await page.getByTestId('mobile-nav').getByTestId('logout-btn').click();
    await expectSignedOut(page);
  });

  test('logging out keeps the light/dark choice: it belongs to the browser, not the account', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('logout-btn').click();
    await expectSignedOut(page);
    expect(await page.evaluate(() => localStorage.getItem('mero-issue-tracker:theme'))).toBe('dark');
  });
});

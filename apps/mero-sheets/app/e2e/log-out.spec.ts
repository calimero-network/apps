/**
 * Log out, from inside the app: the top-bar button drops this browser's node
 * session (mero-react's logout) and lands on the front door, and a reload does
 * not sign you back in.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginViaHash, openNewWorkbook, clearAuth } from './helpers';

async function expectSignedOut(page: Page) {
  // The landing page, not the spreadsheet list (whose heading can read the same).
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.cal-lp-lede')).toBeVisible();
  await expect(page.getByTestId('action-logout')).toHaveCount(0);
  // mero-js keeps the session as one blob; logging out must remove it.
  expect(await page.evaluate(() => localStorage.getItem('mero-tokens'))).toBeNull();
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.cal-lp-lede')).toBeVisible();
  await expect(page.getByTestId('action-logout')).toHaveCount(0);
}

test.describe('Log out', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('from the spreadsheet list', async ({ page }) => {
    await loginViaHash(page, 0);
    const logout = page.getByTestId('action-logout');
    await expect(logout).toBeVisible();
    await expect(logout).toHaveAccessibleName('Log out');
    await logout.click();
    await expectSignedOut(page);
  });

  test('from inside an open spreadsheet, on a phone too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewWorkbook(page, { name: 'Logout check' });
    // On a phone the button is an icon, but it is still there and named.
    await page.getByRole('button', { name: 'Log out' }).click();
    await expectSignedOut(page);
  });
});

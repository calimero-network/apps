/**
 * Light / dark inside the app: light by default, the sun/moon switch in the
 * top bar flips it, and the choice survives a reload with no light flash
 * (index.html puts it on <html> before any module runs).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginViaHash, clearAuth } from './helpers';

const KEY = 'mero-sheets:theme';

/** What <html> said the moment the document was parsed, before the app ran. */
async function recordThemeAtParse(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        (window as unknown as { __themeAtParse?: string | null }).__themeAtParse =
          document.documentElement.getAttribute('data-theme');
      }
    });
  });
}

const themeAtParse = (page: Page) =>
  page.evaluate(() => (window as unknown as { __themeAtParse?: string | null }).__themeAtParse);

test.describe('Theme', () => {
  test.afterEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('opens light, and the top-bar switch flips it both ways', async ({ page }) => {
    await loginViaHash(page, 0);
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    // The page reads light: the glass ground, not the dark one.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 247, 251)');

    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAccessibleName('Use light theme');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 14, 24)');

    await toggle.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAccessibleName('Use dark theme');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('light');
  });

  test('a dark choice is on <html> before the app runs, across reloads', async ({ page }) => {
    await loginViaHash(page, 0);
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await recordThemeAtParse(page);
    for (let i = 0; i < 2; i++) {
      await page.reload();
      await expect(page.getByTestId('theme-toggle')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await themeAtParse(page)).toBe('dark');
    }

    await page.getByTestId('theme-toggle').click();
    await page.reload();
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    expect(await themeAtParse(page)).not.toBe('dark');
  });

  test('a choice saved under the old key carries over', async ({ page }) => {
    await loginViaHash(page, 0);
    await page.evaluate((k) => {
      localStorage.removeItem(k);
      localStorage.setItem('app:theme', 'dark');
    }, KEY);
    await recordThemeAtParse(page);
    await page.reload();
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    expect(await themeAtParse(page)).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('app:theme'))).toBeNull();
  });
});

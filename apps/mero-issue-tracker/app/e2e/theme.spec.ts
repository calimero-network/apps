// Light / dark. Light is the default; the sun/moon button in the top bar flips
// it, the choice is remembered under `mero-issue-tracker:theme`, and index.html puts it
// on <html> before the first paint, so a reload never flashes light first.
import { test, expect, Page } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace } from './helpers';

const KEY = 'mero-issue-tracker:theme';

/** What <html> said the moment the document was parsed, before any module ran. */
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

test.describe('theme', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate((k) => localStorage.removeItem(k), KEY).catch(() => {});
    await clearAuth(page);
  });

  test('defaults to light', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  });

  test('the top-bar switch flips the app to dark and back, and the choice survives a reload', async ({ page }) => {
    await loginViaHash(page, 0);
    await createWorkspace(page);
    const html = page.locator('html');
    const toggle = page.getByTestId('theme-toggle');

    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-label', 'Use dark theme');
    // The app frame really is light: the page ground is the light glass.
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-label', 'Use light theme');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg);

    await recordThemeAtParse(page);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(await themeAtParse(page)).toBe('dark');
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('aria-label', 'Use light theme', { timeout: 30_000 });

    await page.getByTestId('theme-toggle').click();
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('light');
    await page.reload();
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    expect(await themeAtParse(page)).toBeNull();
  });
});

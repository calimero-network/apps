import { expect, test, type Page } from '@playwright/test';

// Light / dark inside the app. Light is the default; the sun/moon button in
// the top bar flips it, the choice is remembered under `mero-pass:theme` (this
// app's own key, not one shared with the fleet), and index.html puts it on
// <html> before the first paint, so a reload never flashes light first.
//
// No node needed: `/teams` mounts the app frame (rail, top bar, toggle) for
// anyone, and the theme is entirely the browser's.

const KEY = 'mero-pass:theme';

/** What <html> said the moment the document was parsed, before any module ran. */
async function recordThemeAtParse(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        (
          window as unknown as { __themeAtParse?: string | null }
        ).__themeAtParse = document.documentElement.getAttribute('data-theme');
      }
    });
  });
}
const themeAtParse = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __themeAtParse?: string | null }).__themeAtParse,
  );
const stored = (page: Page) =>
  page.evaluate((k) => localStorage.getItem(k), KEY);
const ground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme', () => {
  test('the app opens light, and opening it saves nothing', async ({
    page,
  }) => {
    await page.goto('/teams');
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-theme',
      'dark',
    );
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute(
      'aria-label',
      'Switch to dark mode',
    );
    expect(await stored(page)).toBeNull();
  });

  test('the top-bar switch flips the app to dark and back, and the choice survives a reload', async ({
    page,
  }) => {
    await page.goto('/teams');
    const html = page.locator('html');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();
    const lightGround = await ground(page);

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to light mode');
    expect(await stored(page)).toBe('dark');
    // The frame really changed, not just an attribute.
    expect(await ground(page)).not.toBe(lightGround);

    await recordThemeAtParse(page);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    // Dark before any module ran: index.html's inline script, so no flash.
    expect(await themeAtParse(page)).toBe('dark');
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute(
      'aria-label',
      'Switch to light mode',
    );

    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await stored(page)).toBe('light');
    await page.reload();
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    expect(await themeAtParse(page)).not.toBe('dark');
  });

  test('Security → Appearance and the top-bar switch are one setting', async ({
    page,
  }) => {
    await page.goto('/security');
    await page.getByTestId('appearance-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute(
      'aria-label',
      'Switch to light mode',
    );
    await page.getByTestId('theme-toggle').click();
    await expect(page.getByTestId('appearance-light')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('on a phone the switch is in the top bar too, and nothing scrolls sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/teams');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});

// Landing surface - runs without a live merod node.
//
// ⚠️ TRIMMED. `/` is now the shared Calimero landing page, and its own contract
// - hero, badge, sections, features, theme, FAQ, the connect CTA, the desktop
// link - is asserted by the generated `marketing-landing.spec.ts` beside this
// file. Re-asserting it here would be two copies of one contract, and the copy
// nobody regenerates is the one that rots.
//
// What stays is what that spec does NOT cover and this app does own: the
// routing around the page. No tokens injected; the vite dev server is the only
// dependency.

import { test, expect } from '@playwright/test';

test.describe('Landing (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Vite's first-request compile + MeroProvider init.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Mero Docs' }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('the hero is the real Home screen, and takes no input', async ({
    page,
  }) => {
    const hero = page.locator('.cal-lp-a');
    await expect(hero.getByTestId('doc-title')).toHaveCount(7);
    // Real buttons inside an aria-hidden picture must not be focusable.
    await expect(hero).toHaveAttribute('inert', '');
  });

  test('the hero follows the landing theme, not the app theme', async ({
    page,
  }) => {
    await page.evaluate(() =>
      localStorage.setItem('mero-theme', JSON.stringify('dark')),
    );
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    const app = page.locator('.cal-lp-a > div').first();
    await expect(app).toHaveCSS('background-color', 'rgb(250, 250, 250)');
    await page.getByTestId('theme-toggle').click();
    await expect(app).toHaveCSS('background-color', 'rgb(14, 14, 16)');
  });

  test('unknown routes redirect to /', async ({ page }) => {
    await page.goto('/nonexistent-path');
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Mero Docs' }),
    ).toBeVisible();
  });

  test('protected /app route redirects unauthenticated users', async ({
    page,
  }) => {
    // Without tokens, /app/* should bounce back to the landing or
    // login page. Either way the workspace UI must NOT mount -
    // FolderTree's "New folder" affordance is a definitive negative
    // signal.
    await page.goto('/app');
    await expect(page).not.toHaveURL(/\/app/, { timeout: 15_000 });
  });
});

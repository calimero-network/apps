/**
 * Landing surface — runs without a live merod node.
 *
 * ⚠️ TRIMMED. `/` is now the shared Calimero landing page, and its own contract
 * — hero, badge, sections, features, theme, FAQ, the connect CTA, the desktop
 * link — is asserted by the generated `marketing-landing.spec.ts` in this same
 * project. Re-asserting it here would be two copies of one contract, and the
 * copy nobody regenerates is the one that rots.
 *
 * What stays is what that spec does NOT cover and this app does own: the
 * routing around the page, and the reveal regression guard.
 */

import { test, expect } from '@playwright/test';

test.describe('Landing (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Vite's first-request compile + MeroProvider init to settle.
    await expect(page.getByRole('heading', { level: 1, name: 'Battleships' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('the explainer is fully visible at rest, with no scrolling', async ({ page }) => {
    // Regression guard, learned on mero-forum's equivalent page: a scroll-reveal
    // that parks sections at opacity 0 behind an IntersectionObserver renders
    // them as empty bands for anyone who does not scroll, and in every link
    // preview and thumbnail.
    const faint = await page.evaluate(() =>
      [...document.querySelectorAll('section, h2, h3, li, p')]
        .filter(
          (el) =>
            parseFloat(getComputedStyle(el).opacity) < 0.9 &&
            (el.textContent ?? '').trim().length > 10,
        )
        .map((el) => `${el.tagName}: ${(el.textContent ?? '').trim().slice(0, 40)}`),
    );
    expect([...new Set(faint)], 'content parked below full opacity at rest').toEqual([]);
  });

  test('unknown routes redirect to /', async ({ page }) => {
    await page.goto('/nonexistent-path');
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Battleships' })).toBeVisible();
  });

  test('protected /lobby route requires auth', async ({ page }) => {
    // Without injected tokens the page either redirects to '/' or stays on
    // /lobby but renders the auth prompt — either way the ConnectButton is
    // visible and gameplay UI is not.
    await page.goto('/lobby');
    // Either shape is a pass: bounced to the landing page, whose CTA is the way
    // in, or held on /lobby behind mero-react's own connect prompt.
    await expect(
      page.locator('a, button').filter({ hasText: /^Connect( to node| a node)?$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

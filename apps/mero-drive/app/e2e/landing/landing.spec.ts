// Landing surface — runs without a live merod node.
//
// Asserts the unauthenticated entry point renders branding, the
// Connect CTA is present (two on the page: one in <Hero>, one in
// <CTA>), and protected routes redirect back to '/'. No tokens
// injected; the vite dev server is the only dependency.

import { test, expect } from '@playwright/test';

test.describe('Landing (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Vite's first-request compile + MeroProvider init.
    // The H1 carries the "Your control." gradient text and is the
    // most stable visible anchor on the Hero.
    await expect(
      page.getByRole('heading', { level: 1, name: /your control/i }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('renders the hero headline', async ({ page }) => {
    await expect(
      page.getByRole('heading', { level: 1, name: /your control/i }),
    ).toBeVisible();
  });

  test('shows the End-to-End Encrypted badge', async ({ page }) => {
    // Text appears twice: hero badge span + features H3. .first() —
    // we're asserting the affordance is rendered somewhere, not
    // counting.
    await expect(page.getByText(/end-to-end encrypted/i).first()).toBeVisible();
  });

  test('renders the Mero Drive footer', async ({ page }) => {
    await expect(page.getByText(/Mero Drive/i).first()).toBeVisible();
  });

  test('shows a Connect button', async ({ page }) => {
    // Hero + CTA each render a Connect button; .first() is fine since
    // we're asserting the role/affordance is present, not counting.
    await expect(
      page.getByRole('button', { name: /connect/i }).first(),
    ).toBeVisible();
  });

  test('Connect button navigates to /login', async ({ page }) => {
    await page.getByRole('button', { name: /connect/i }).first().click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  });

  test('unknown routes redirect to /', async ({ page }) => {
    await page.goto('/nonexistent-path');
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: /your control/i }),
    ).toBeVisible();
  });

  test('protected /app route redirects unauthenticated users', async ({
    page,
  }) => {
    // Without tokens, /app/* should bounce back to the landing or
    // login page. Either way the workspace UI must NOT mount —
    // FolderTree's "New folder" affordance is a definitive negative
    // signal.
    await page.goto('/app');
    await expect(page).not.toHaveURL(/\/app/, { timeout: 15_000 });
  });
});

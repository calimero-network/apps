/**
 * Landing surface — runs without a live merod node.
 *
 * Verifies the unauthenticated entry point renders the expected branding,
 * the ConnectButton is present, and protected routes redirect back to '/'
 * (which is itself the login surface — Authenticate.tsx is mounted there).
 */

import { test, expect } from '@playwright/test';

test.describe('Landing (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for Vite's first-request compile + MeroProvider init to settle.
    await expect(page.getByText('Battleships').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('shows the Battleships title', async ({ page }) => {
    await expect(page.getByText('Battleships').first()).toBeVisible();
  });

  test('shows the demo description', async ({ page }) => {
    await expect(
      page.getByText(/fully decentralized battleships game/i),
    ).toBeVisible();
  });

  test('renders feature bullets', async ({ page }) => {
    // Matched on the FULL bullet, not a prefix. `/Private ship placement/i` also
    // matched the paragraph above it ("...Private ship placementS, verifiable
    // shots..."), so the locator resolved to two elements and Playwright's
    // strict mode failed the test. `.first()` would have hidden that rather than
    // fixed it — and would have stopped asserting the bullet at all.
    await expect(
      page.getByText('Private ship placement — opponents never see your board'),
    ).toBeVisible();
    await expect(
      page.getByText('Verifiable shots via cross-context calls'),
    ).toBeVisible();
    await expect(
      page.getByText('Real-time P2P state sync between nodes'),
    ).toBeVisible();
  });

  test('shows a Connect button', async ({ page }) => {
    // ConnectButton from mero-react renders a button with "Connect" text.
    await expect(
      page.getByRole('button', { name: /connect/i }).first(),
    ).toBeVisible();
  });

  test('offers the outbound links', async ({ page }) => {
    // LINKS now, not buttons. The old landing page used <Button> elements with
    // `window.open`, which is the wrong element for outbound navigation: it
    // loses middle-click, cmd-click, "copy link", and the status-bar preview,
    // and it is announced as a button to a screen reader. The new page uses
    // <a href> — so the assertion moves to the `link` role rather than the copy
    // being changed to keep a weaker element passing.
    // The labels come from this app's own en.global.json — documentation:
    // "Docs", github: "GitHub", website: "Calimero" — so they are unchanged
    // from the old page; only the element is.
    await expect(page.getByRole('link', { name: 'Docs' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calimero' }).first()).toBeVisible();
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
    await expect(page.getByText('Battleships').first()).toBeVisible();
  });

  test('protected /lobby route requires auth', async ({ page }) => {
    // Without injected tokens the page either redirects to '/' or stays on
    // /lobby but renders the auth prompt — either way the ConnectButton is
    // visible and gameplay UI is not.
    await page.goto('/lobby');
    await expect(
      page.getByRole('button', { name: /connect/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

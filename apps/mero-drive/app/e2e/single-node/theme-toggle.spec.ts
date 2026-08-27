// Theme toggle — new coverage for the PR1 top-bar dark/light switch.
//
// The app defaults to dark mode. The toggle button aria-label reads
// "Switch to light mode" when dark, "Switch to dark mode" when light.
// Toggling removes/adds the `dark` class on <html>. The choice
// persists across page reloads.

import { test, expect } from '../fixtures/single-user';

test.describe('Theme toggle (single-node)', () => {
  test('dark → light removes dark class and flips label', async ({ alice }) => {
    await alice.goToWorkspace();

    // App starts in dark mode — toggle shows "Switch to light mode".
    const toggleDark = alice.page.getByRole('button', {
      name: /Switch to light mode/i,
    });
    await expect(toggleDark).toBeVisible({ timeout: 15_000 });

    // Click to switch to light.
    await toggleDark.click();

    // Button label flips to "Switch to dark mode".
    await expect(
      alice.page.getByRole('button', { name: /Switch to dark mode/i }),
    ).toBeVisible();

    // <html> no longer has the `dark` class.
    expect(
      await alice.page.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      ),
    ).toBe(false);
  });

  test('light mode persists across page reload', async ({ alice }) => {
    await alice.goToWorkspace();

    // Switch to light.
    await alice.page
      .getByRole('button', { name: /Switch to light mode/i })
      .click();
    await expect(
      alice.page.getByRole('button', { name: /Switch to dark mode/i }),
    ).toBeVisible();

    // Reload and wait for the shell to remount.
    await alice.page.reload();
    await expect(alice.page.locator('select').first()).toBeVisible({
      timeout: 30_000,
    });

    // Light preference persisted — still no `dark` class and toggle
    // still reads "Switch to dark mode".
    expect(
      await alice.page.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      ),
    ).toBe(false);
    await expect(
      alice.page.getByRole('button', { name: /Switch to dark mode/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

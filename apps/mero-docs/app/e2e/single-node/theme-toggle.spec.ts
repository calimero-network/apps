// Theme toggle — new coverage for the PR1 top-bar dark/light switch.
//
// The app defaults to light mode. The toggle button aria-label reads
// "Switch to dark mode" when light, "Switch to light mode" when dark.
// Toggling adds/removes the `dark` class on <html>. The choice
// persists across page reloads.

import { test, expect } from '../fixtures/single-user';

test.describe('Theme toggle (single-node)', () => {
  test('light → dark adds dark class and flips label', async ({ alice }) => {
    await alice.goToWorkspace();

    // App starts in light mode: the toggle shows "Switch to dark mode".
    const toggleLight = alice.page.getByRole('button', {
      name: /Switch to dark mode/i,
    });
    await expect(toggleLight).toBeVisible({ timeout: 15_000 });
    expect(
      await alice.page.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      ),
    ).toBe(false);

    await toggleLight.click();

    await expect(
      alice.page.getByRole('button', { name: /Switch to light mode/i }),
    ).toBeVisible();
    expect(
      await alice.page.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      ),
    ).toBe(true);
  });

  test('dark mode persists across page reload', async ({ alice }) => {
    await alice.goToWorkspace();

    await alice.page
      .getByRole('button', { name: /Switch to dark mode/i })
      .click();
    await expect(
      alice.page.getByRole('button', { name: /Switch to light mode/i }),
    ).toBeVisible();

    // Reload and wait for the shell to remount.
    await alice.page.reload();
    await expect(alice.page.getByTestId('workspace-switcher')).toBeVisible({
      timeout: 30_000,
    });

    // The index.html bootstrap re-applies the saved dark choice.
    expect(
      await alice.page.evaluate(() =>
        document.documentElement.classList.contains('dark'),
      ),
    ).toBe(true);
    await expect(
      alice.page.getByRole('button', { name: /Switch to light mode/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
